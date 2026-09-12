from dataclasses import replace

from fastapi.testclient import TestClient

from app.case_schemas import CaseDecision
from app.claim_verification import (
    ClaimVerificationService,
    EvidenceAssessment,
    FakeVerificationProvider,
    VerificationDecision,
)
from app.config import Settings
from app.demo_loader import load_sources
from app.main import create_app
from app.schemas import Claim


class ReplayExtractor:
    def __init__(self) -> None:
        self.calls = 0

    async def extract(self, signal_id, source):
        self.calls += 1
        return [Claim(
            claim_id=f"clm_{signal_id}", signal_id=signal_id,
            kind="hypothesis", quote=source.raw_text[:20],
            normalized_statement="泰山某批沙拉油可能正被通路收回",
            entities=[{"type": "brand", "name": "泰山"}],
            scope={"region": None, "batch": None, "time_window": None},
            verification_status="insufficient_evidence", evidence=[],
        )]


class ReplayCaseDecider:
    def __init__(self) -> None:
        self.calls = 0

    async def decide(self, *, signal, cases, case_signals, updated_claims,
                     updates, replay_at, products):
        self.calls += 1
        if signal is not None:
            assert cases == []
            impact, priority, status = "pending", "medium", "monitoring"
            case_id = None
            refs = [signal.signal_id, signal.claims[0].claim_id]
        else:
            assert len(cases) == 1
            case_id = cases[0].case_id
            assert len(case_signals[case_id]) == 2
            assert updated_claims[0].verification_status == "supported"
            assert updates[0].evidence == updated_claims[0].evidence
            impact, priority, status = "risk", "critical", "awaiting_approval"
            refs = [updates[0].claim_id, updates[0].evidence[0].evidence_id]
        return CaseDecision(
            case_id=case_id, title="泰山沙拉油疑似通路收回",
            status=status, business_impact=impact, priority=priority,
            priority_reasons=["依已保存來源與證據更新"],
            unknowns=["商品批號仍需核對"], next_steps=["核對候選商品"],
            monitoring_plan={"targets": ["官方公告"], "next_check_at": None,
                             "reason": "等待後續資訊"},
            candidate_products=[], summary="案件判讀已更新",
            reason="依已保存來源與證據更新", source_refs=refs,
        )


def test_a_ingest_repost_verify_and_b_advance_share_one_app(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = replace(Settings.from_env(), db_path=str(tmp_path / "ab.sqlite3"),
                       public_origin="http://testserver")
    extractor = ReplayExtractor()
    decider = ReplayCaseDecider()
    verifier = ClaimVerificationService(FakeVerificationProvider([
        VerificationDecision(
            verification_status="supported",
            evidence_assessments=(EvidenceAssessment(
                evidence_id="ev_s4_fda_20260701", stance="supports"
            ),),
        ),
    ]))
    application = create_app(settings, claim_extractor=extractor,
                             claim_verifier=verifier, case_decider=decider)
    assert application.state.case_store.signal_reader is application.state.signal_store

    with TestClient(application) as client:
        signals = []
        for stage in (1, 2):
            payload = load_sources(stage)[0].model_dump(mode="json", exclude={"stage"})
            response = client.post("/api/v1/signals/ingest", json=payload,
                                   headers={"Idempotency-Key": f"ab-stage-{stage}"})
            assert response.status_code == 200, response.json()
            signals.append(response.json())
        assert signals[1]["claims"] == []
        assert signals[1]["duplicate_of_signal_id"] == signals[0]["signal_id"]
        assert extractor.calls == decider.calls == 1
        inbox = client.get("/api/v1/signals")
        assert inbox.status_code == 200
        assert len(inbox.json()["items"]) == 2
        assert all(item["case_id"] for item in inbox.json()["items"])
        assert inbox.json()["items"][0]["claims"] == []

        listed = client.get("/api/v1/cases").json()["items"]
        assert len(listed) == 1
        case_id = listed[0]["case_id"]
        assert listed[0]["version"] == 1
        assert application.state.case_store.case_id_for_signal(signals[1]["signal_id"]) == case_id
        assert [event["kind"] for event in client.get(
            f"/api/v1/cases/{case_id}/timeline"
        ).json()["items"]] == [
            "signal_added", "assessment_updated", "monitoring_updated",
            "signal_added",
        ]

        claim_id = signals[0]["claims"][0]["claim_id"]
        verified = client.post(
            f"/api/v1/claims/{claim_id}/verify",
            json={"evidence_ids": ["ev_s4_fda_20260701"], "current_stage": 4},
            headers={"Idempotency-Key": "ab-verify-stage-4"},
        )
        assert verified.status_code == 200, verified.json()
        claim = verified.json()
        assert claim["verification_status"] == "supported"
        assert application.state.signal_store.get_claim(claim_id).evidence

        advanced = client.post(
            f"/api/v1/cases/{case_id}/advance",
            json={"expected_version": 1, "verification_updates": [{
                "claim_id": claim_id,
                "verification_status": claim["verification_status"],
                "evidence": claim["evidence"],
            }]},
            headers={"Idempotency-Key": "ab-advance-stage-4"},
        )
        assert advanced.status_code == 200, advanced.json()
        assert advanced.json()["version"] == 2
        assert advanced.json()["priority"] == "critical"
        assert client.get(f"/api/v1/cases/{case_id}/agent-status").json()["state"] == "waiting_human"
        assert decider.calls == 2


def test_inbox_keeps_unassigned_signal_visible_after_dispatch_failure(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = replace(Settings.from_env(), db_path=str(tmp_path / "failed.sqlite3"),
                       public_origin="http://testserver")

    class FailingDispatcher:
        async def dispatch(self, signal_id):
            raise RuntimeError("simulated handoff failure")

    with TestClient(create_app(settings, claim_extractor=ReplayExtractor(),
                               case_dispatcher=FailingDispatcher())) as client:
        payload = load_sources(1)[0].model_dump(mode="json", exclude={"stage"})
        response = client.post("/api/v1/signals/ingest", json=payload,
                               headers={"Idempotency-Key": "failed-handoff"})
        assert response.status_code == 502
        items = client.get("/api/v1/signals").json()["items"]
        assert len(items) == 1
        assert items[0]["case_id"] is None
        assert items[0]["claims"]
