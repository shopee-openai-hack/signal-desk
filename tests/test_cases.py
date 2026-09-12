from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.case_schemas import CaseDecision, CaseSnapshot, Signal, TimelinePage, VerificationUpdate
from app.case_agent import InProcessCaseDispatcher, InvalidCaseDecision, OpenAICaseDecider, CaseService
from app.case_store import CaseStore, SignalConflict
from app.config import Settings
from app.main import create_app
from app.store import DailyLimitReached
import pytest


START = datetime(2026, 9, 12, 2, 0, tzinfo=timezone.utc)


def signal(signal_id: str, claim_id: str | None, relation: str = "original") -> Signal:
    return Signal.model_validate({
        "signal_id": signal_id,
        "source": {"provider": "replay", "source_id": signal_id,
                   "url": f"https://example.test/{signal_id}", "author_ref": None,
                   "published_at": START.isoformat(), "retrieved_at": START.isoformat(),
                   "raw_text": "An oil safety report", "retrieval_status": "succeeded"},
        "source_relation": relation,
        "duplicate_of_signal_id": "sig_001" if relation == "repost" else None,
        "claims": [] if claim_id is None else [{"claim_id": claim_id, "signal_id": signal_id, "kind": "fact",
                    "quote": "An oil safety report", "normalized_statement": "Oil may be unsafe",
                    "entities": [], "scope": {"region": None, "batch": None, "time_window": None},
                    "verification_status": "insufficient_evidence", "evidence": []}],
    })


class FakeDecider:
    def __init__(self):
        self.calls = 0
        self.contexts = []

    async def decide(self, *, signal, cases, case_signals, updated_claims,
                     updates, replay_at, products):
        self.calls += 1
        self.contexts.append((case_signals, updated_claims))
        if updates:
            case_id = cases[0].case_id
            priority = "low"
            refs = [updates[0].claim_id, updates[0].evidence[0].evidence_id]
            summary = "Official source refutes the allegation"
        else:
            case_id = cases[0].case_id if cases and signal.source_relation == "repost" else None
            priority = "high"
            refs = [signal.signal_id, signal.claims[0].claim_id]
            summary = "Safety concern needs investigation"
        return CaseDecision(
            case_id=case_id, title="Oil safety concern", status="investigating",
            business_impact="risk", priority=priority,
            priority_reasons=[summary], unknowns=["Affected batch unknown"],
            next_steps=["Review official sources"],
            monitoring_plan={"targets": ["official sources"],
                             "next_check_at": (START + timedelta(minutes=15)).isoformat(),
                             "reason": "Check for new evidence"},
            candidate_products=[], summary=summary, reason=summary, source_refs=refs,
        )


def test_controlled_replay_case_history_and_idempotency(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = replace(Settings.from_env(), db_path=str(tmp_path / "case.sqlite3"),
                       public_origin="http://testserver")
    store = CaseStore(settings.db_path)
    store.init_schema()
    store.save_signal(signal("sig_001", "clm_001"))
    store.save_signal(signal("sig_002", None, "repost"))
    store.save_signal(signal("sig_003", "clm_003"))
    assert store.case_id_for_signal("sig_001") is None
    decider = FakeDecider()
    with TestClient(create_app(settings, case_store=store, case_decider=decider)) as client:
        first = client.post("/api/v1/cases/dispatch", json={"signal_id": "sig_001",
                            "replay_at": START.isoformat()}, headers={"Idempotency-Key": "stage-1"})
        assert first.status_code == 200
        one = first.json()
        assert one["version"] == 1 and one["claim_ids"] == ["clm_001"]
        assert store.case_id_for_signal("sig_001") == one["case_id"]
        agent_status_path = f"/api/v1/cases/{one['case_id']}/agent-status"
        observed = client.get(agent_status_path)
        assert observed.status_code == 200
        assert observed.json()["state"] == "waiting_follow_up"
        assert observed.json()["source"] == "backend"

        repost = client.post("/api/v1/cases/dispatch", json={"signal_id": "sig_002",
                             "replay_at": (START + timedelta(minutes=5)).isoformat()},
                             headers={"Idempotency-Key": "stage-2"})
        assert repost.status_code == 200
        assert repost.json()["case_id"] == one["case_id"]
        assert repost.json()["version"] == 1
        assert repost.json()["claim_ids"] == ["clm_001"]
        assert decider.calls == 1
        summary_after_repost = client.get("/api/v1/cases").json()["items"][0]
        assert summary_after_repost["updated_at"] == (START + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
        assert client.get(f"/api/v1/cases/{one['case_id']}").json()["updated_at"] == START.isoformat().replace("+00:00", "Z")

        separate = client.post("/api/v1/cases/dispatch", json={"signal_id": "sig_003"},
                               headers={"Idempotency-Key": "stage-3"})
        assert separate.status_code == 200
        assert separate.json()["case_id"] != one["case_id"]
        assert [item.signal_id for item in decider.contexts[-1][0][one["case_id"]]] == [
            "sig_001", "sig_002"
        ]

        evidence = {"evidence_id": "ev_001", "claim_id": "clm_001",
                    "url": "https://example.test/official", "title": "Official notice",
                    "publisher": "Demo authority", "published_at": START.isoformat(),
                    "retrieved_at": (START + timedelta(minutes=10)).isoformat(),
                    "excerpt": "No such batch recalled", "stance": "refutes"}
        payload = {"expected_version": 1, "replay_at": (START + timedelta(minutes=10)).isoformat(),
                   "verification_updates": [{"claim_id": "clm_001", "verification_status": "refuted",
                                             "evidence": [evidence]}]}
        advanced = client.post(f"/api/v1/cases/{one['case_id']}/advance", json=payload,
                               headers={"Idempotency-Key": "stage-4"})
        assert advanced.status_code == 200
        assert advanced.json()["version"] == 2 and advanced.json()["priority"] == "low"
        assert client.post(f"/api/v1/cases/{one['case_id']}/advance", json=payload,
                           headers={"Idempotency-Key": "stage-4"}).json()["version"] == 2
        assert client.post("/api/v1/cases/dispatch", json={"signal_id": "sig_001",
                           "replay_at": START.isoformat()},
                           headers={"Idempotency-Key": "stage-1"}).json()["version"] == 1
        assert decider.calls == 3
        assert client.post(f"/api/v1/cases/{one['case_id']}/advance", json=payload,
                           headers={"Idempotency-Key": "new-key"}).status_code == 409
        timeline = client.get(f"/api/v1/cases/{one['case_id']}/timeline").json()["items"]
        assert [item["kind"] for item in timeline[:3]] == [
            "signal_added", "assessment_updated", "monitoring_updated"
        ]
        assert [item["kind"] for item in timeline].count("signal_added") == 2
        assert [item["kind"] for item in timeline].count("assessment_updated") == 2
        assert all(item["actor"]["type"] == "case_agent" for item in timeline)
        assert any(item["kind"] == "verification_updated" for item in timeline)
        summaries = client.get("/api/v1/cases").json()["items"]
        assert len(summaries) == 2
        summary = next(item for item in summaries if item["case_id"] == one["case_id"])
        assert summary["latest_change"] is not None
        assert summary["next_check_at"] is not None
        assert summary["agent_state"] == "waiting_follow_up"
        assert any(case.case_id == one["case_id"] for case in
                   store.due_cases(START + timedelta(minutes=20)))

    with TestClient(create_app(settings, case_store=CaseStore(settings.db_path),
                               case_decider=FakeDecider())) as client:
        assert client.get(f"/api/v1/cases/{one['case_id']}").json()["version"] == 2
        assert client.get(agent_status_path).json()["state"] == "waiting_follow_up"


def test_missing_signal_and_invalid_verdict(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = replace(Settings.from_env(), db_path=str(tmp_path / "case.sqlite3"),
                       public_origin="http://testserver")
    store = CaseStore(settings.db_path)
    store.init_schema()
    store.save_signal(signal("sig_001", "clm_001"))
    with TestClient(create_app(settings, case_store=store, case_decider=FakeDecider())) as client:
        assert client.post("/api/v1/cases/dispatch", json={"signal_id": "missing"},
                           headers={"Idempotency-Key": "missing"}).status_code == 404
        assert client.get("/api/v1/cases/missing/agent-status").status_code == 404
        assert client.post("/api/v1/cases/dispatch", json={"signal_id": "sig_001"}).status_code == 422
        created = client.post("/api/v1/cases/dispatch", json={"signal_id": "sig_001"},
                              headers={"Idempotency-Key": "first"}).json()
        result = client.post(f"/api/v1/cases/{created['case_id']}/advance",
                             json={"expected_version": 1, "verification_updates": [{
                                 "claim_id": "clm_001", "verification_status": "supported", "evidence": []}]},
                             headers={"Idempotency-Key": "bad-verdict"})
        assert result.status_code == 422


def test_c_fixtures_follow_shared_models():
    fixture_dir = Path(__file__).resolve().parent.parent / "contracts" / "fixtures"
    case = CaseSnapshot.model_validate_json((fixture_dir / "b_case_snapshot.json").read_text())
    timeline = TimelinePage.model_validate_json((fixture_dir / "b_case_timeline.json").read_text())
    assert all(item.case_id == case.case_id and item.case_version == case.version
               for item in timeline.items)
    assert (case.business_impact, case.priority, case.status) == (
        "pending", "medium", "monitoring"
    )
    assert {item.product_id for item in case.candidate_products} == {"prod_001", "prod_002"}
    assert timeline.items[-1].kind == "signal_added"
    assert timeline.items[-1].source_refs == ["sig_s2_post_002", "sig_s1_post_001"]


def test_openai_case_decider_uses_structured_response_without_network(monkeypatch, tmp_path):
    from app import case_agent
    calls = []
    expected = CaseDecision(
        case_id=None, title="Oil safety concern", status="investigating",
        business_impact="risk", priority="high", priority_reasons=["Potential harm"],
        unknowns=["Batch unknown"], next_steps=["Check official source"],
        monitoring_plan={"targets": ["official source"], "next_check_at": None,
                         "reason": "Awaiting evidence"}, candidate_products=[],
        summary="Investigate report", reason="Potential harm", source_refs=["sig_001"],
    )

    class FakeCompletions:
        async def parse(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=expected))])

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=FakeCompletions())

        async def close(self):
            pass

    monkeypatch.setattr(case_agent, "AsyncOpenAI", FakeClient)
    settings = replace(Settings.from_env(), openai_api_key="test-only",
                       db_path=str(tmp_path / "app.sqlite3"))
    import asyncio
    async def run():
        decider = OpenAICaseDecider(settings)
        try:
            return await decider.decide(signal=signal("sig_001", "clm_001"), cases=[],
                                        case_signals={}, updated_claims=[],
                                        updates=[], replay_at=START, products=[])
        finally:
            await decider.close()
    assert asyncio.run(run()) == expected
    assert calls[0]["response_format"] is CaseDecision
    assert calls[0]["model"] == settings.openai_model


def test_case_model_budget_persists_across_store_instances(tmp_path):
    path = str(tmp_path / "cases.sqlite3")
    store = CaseStore(path)
    store.init_schema()
    store.reserve_model_call(1)
    with pytest.raises(DailyLimitReached):
        CaseStore(path).reserve_model_call(1)


def test_a_store_reader_and_in_process_handoff(tmp_path):
    import asyncio

    first_signal = signal("sig_001", "clm_001")

    class AReader:
        def get_signal(self, signal_id):
            return first_signal if signal_id == first_signal.signal_id else None

        def get_claim(self, claim_id):
            return first_signal.claims[0] if claim_id == "clm_001" else None

    store = CaseStore(str(tmp_path / "cases.sqlite3"), signal_reader=AReader())
    store.init_schema()
    decider = FakeDecider()
    dispatcher = InProcessCaseDispatcher(CaseService(store, decider))

    async def handoff():
        await dispatcher.dispatch("sig_001")
        await dispatcher.dispatch("sig_001")

    asyncio.run(handoff())
    assert decider.calls == 1
    assert store.assigned_case("sig_001") is not None
    with pytest.raises(SignalConflict):
        store.save_signal(first_signal)

    forged = VerificationUpdate.model_validate({
        "claim_id": "clm_001", "verification_status": "supported",
        "evidence": [{"evidence_id": "ev_fake", "claim_id": "clm_001",
                      "url": "https://example.test/fake", "title": "Fake",
                      "publisher": "Unknown", "published_at": START.isoformat(),
                      "retrieved_at": START.isoformat(), "excerpt": "Fake",
                      "stance": "supports"}],
    })
    with pytest.raises(InvalidCaseDecision):
        asyncio.run(dispatcher.service.advance(
            store.assigned_case("sig_001").case_id, 1, [forged], key="forged"
        ))

    verified = VerificationUpdate.model_validate({
        "claim_id": "clm_001", "verification_status": "refuted",
        "evidence": [{"evidence_id": "ev_official", "claim_id": "clm_001",
                      "url": "https://example.test/official", "title": "Official notice",
                      "publisher": "Demo authority", "published_at": START.isoformat(),
                      "retrieved_at": START.isoformat(), "excerpt": "No recall",
                      "stance": "refutes"}],
    })
    first_signal.claims[0].verification_status = "refuted"
    first_signal.claims[0].evidence = verified.evidence
    advanced = asyncio.run(dispatcher.service.advance(
        store.assigned_case("sig_001").case_id, 1, [verified], key="verified"
    ))
    assert advanced is not None and advanced.version == 2
