"""The four UI pages must work against FastAPI without a Node mock process."""

from dataclasses import replace

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


CASE_ID = "case_zhonglian_oil"


def client_for_demo(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = replace(Settings.from_env(), db_path=str(tmp_path / "demo.sqlite3"))
    return TestClient(create_app(settings))


def advance(client, stage):
    response = client.post("/api/v1/demo/advance", json={"expected_stage": stage},
                           headers={"Idempotency-Key": f"stage-{stage}"})
    assert response.status_code == 200, response.json()
    return response.json()


def approve(client, version, product_ids, key):
    return client.post(f"/api/v1/demo/cases/{CASE_ID}/approvals",
                       json={"case_version": version, "product_ids": product_ids},
                       headers={"Idempotency-Key": key})


def execute(client, approval_id, key):
    return client.post(f"/api/v1/demo/approvals/{approval_id}/execute", json={},
                       headers={"Idempotency-Key": key})


def test_fastapi_full_replay_and_c_actions(tmp_path, monkeypatch):
    with client_for_demo(tmp_path, monkeypatch) as client:
        assert client.get("/api/v1/demo/status").json()["stage"] == 3
        assert client.get("/api/v1/cases").json()["items"] == []
        assert len(client.get("/api/v1/demo/cases").json()["items"]) == 1
        assert len(client.get("/api/v1/demo/signals").json()["items"]) == 3
        assert len(client.get("/api/v1/demo/products").json()["items"]) == 9
        observation = client.get(f"/api/v1/demo/cases/{CASE_ID}/agent-status").json()
        assert observation["source"] == "backend_replay"
        assert all("Stage" not in str(value) and "注入" not in str(value)
                   for value in observation.values())
        assert "官方證據" in observation["current_step"]
        trace = client.get("/api/v1/demo/traces/trace_oil_main").json()
        assert len(trace["phases"]) == 6
        assert trace["phases"][3]["status"] == "waiting_human"

        assert client.post("/api/v1/demo/reset", json={"stage": 0}).status_code == 200
        assert client.get("/api/v1/demo/cases").json()["items"] == []
        first = advance(client, 0)["case"]
        repost = advance(client, 1)["case"]
        assert first["version"] == repost["version"] == 1
        assert first["claim_ids"] == repost["claim_ids"]
        assert first["updated_at"] == repost["updated_at"]
        assert len(client.get("/api/v1/demo/signals").json()["items"]) == 2
        timeline = client.get(f"/api/v1/demo/cases/{CASE_ID}/timeline").json()["items"]
        assert timeline[1]["kind"] == "signal_added"
        assert timeline[1]["case_version"] == 1
        assert advance(client, 2)["case"]["version"] == 2
        stage4 = advance(client, 3)["case"]
        assert stage4["version"] == 3
        assert stage4["status"] == "awaiting_approval"
        assert client.post("/api/v1/demo/advance", json={"expected_stage": 4},
                           headers={"Idempotency-Key": "blocked-advance"}).status_code == 409
        assert approve(client, 3, ["prod_002"], "invalid-approval").status_code == 422
        approved = approve(client, 3, ["prod_001", "prod_003", "prod_005"], "stage4-approval")
        assert approved.status_code == 201
        approval_id = approved.json()["approval"]["approval_id"]
        assert all(item["status"] == "active" for item in client.get("/api/v1/demo/products").json()["items"])
        result = execute(client, approval_id, "stage4-execute")
        assert result.status_code == 200
        assert result.json()["summary"] == {"succeeded": 3, "failed": 0, "total": 3}
        delisted = {item["product_id"] for item in client.get("/api/v1/demo/products").json()["items"]
                    if item["status"] == "delisted"}
        assert delisted == {"prod_001", "prod_003", "prod_005"}
        assert client.get(f"/api/v1/demo/cases/{CASE_ID}/agent-status").json()["state"] == "waiting_follow_up"
        assert client.get("/api/v1/demo/cases").json()["items"][0]["agent_state"] == "waiting_follow_up"
        assert len(client.get(f"/api/v1/demo/cases/{CASE_ID}/approvals").json()["items"][0]["executions"]) == 3
        stage5 = advance(client, 4)["case"]
        assert stage5["version"] == 4
        assert execute(client, approval_id, "stale-execute").status_code == 409
        fresh = approve(client, 4, ["prod_007"], "stage5-approval")
        assert fresh.status_code == 201
        stage6 = advance(client, 5)["case"]
        assert stage6["version"] == 5
        assert next(item for item in stage6["candidate_products"] if item["product_id"] == "prod_009")["relation"] == "excluded"
        assert {item["product_id"] for item in client.get("/api/v1/demo/products").json()["items"]
                if item["status"] == "delisted"} == delisted

    # The same SQLite file must restore the UI after a backend restart.
    with client_for_demo(tmp_path, monkeypatch) as restarted:
        assert restarted.get("/api/v1/demo/status").json()["stage"] == 6
        assert len(restarted.get(f"/api/v1/demo/cases/{CASE_ID}/approvals").json()["items"]) == 2
        assert restarted.get(f"/api/v1/demo/cases/{CASE_ID}").json()["version"] == 5


def test_fastapi_failure_retry_keeps_one_execution(tmp_path, monkeypatch):
    with client_for_demo(tmp_path, monkeypatch) as client:
        client.post("/api/v1/demo/reset", json={"stage": 3, "scenario": "failure_retry"})
        advance(client, 3)
        stage4 = approve(client, 3, ["prod_001", "prod_003", "prod_005"], "gate-approval").json()
        execute(client, stage4["approval"]["approval_id"], "gate-execute")
        advance(client, 4)
        approval = approve(client, 4, ["prod_007"], "retry-approval").json()["approval"]
        failed = execute(client, approval["approval_id"], "retry-first").json()["executions"][0]
        assert failed["status"] == "failed" and failed["attempts"] == 1
        succeeded = execute(client, approval["approval_id"], "retry-second").json()["executions"][0]
        assert succeeded["status"] == "succeeded" and succeeded["attempts"] == 2
        assert succeeded["execution_id"] == failed["execution_id"]
