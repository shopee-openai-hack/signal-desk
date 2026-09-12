from __future__ import annotations

import asyncio
import json
import sqlite3
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.claim_extraction import ClaimExtractor
from app.claim_verification import (
    ClaimVerificationService,
    FakeVerificationProvider,
)
from app.config import Settings
from app.demo_loader import SourceInput, load_sources
from app.main import create_app
from app.schemas import Claim, Evidence, Signal, Source
from app.signal_store import SQLiteSignalStore


class PackDraftProvider:
    """Deterministic extraction drafts for D's committed six-stage pack."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.calls: list[str] = []

    async def generate(self, source: Source, *, correction: bool) -> object:
        _assert_write_lock_available(self.db_path)
        await asyncio.sleep(0)
        assert not correction
        self.calls.append(source.source_id)
        drafts: dict[str, list[dict[str, Any]]] = {
            "post_001": [
                {
                    "kind": "experience",
                    "quote": "我家上週剛買一桶，味道好像有點怪",
                    "normalized_statement": "發文者表示上週購買的一桶油味道有點怪",
                    "entities": [],
                    "scope": {
                        "region": None,
                        "batch": None,
                        "time_window": None,
                    },
                }
            ],
            "post_003": [
                {
                    "kind": "experience",
                    "quote": "我在蝦皮買的福壽大豆沙拉油，瓶身標示原料批號 315-1150404",
                    "normalized_statement": "發文者表示在蝦皮購買的福壽大豆沙拉油標示原料批號 315-1150404",
                    "entities": [{"type": "brand", "name": "福壽"}],
                    "scope": {
                        "region": None,
                        "batch": "315-1150404",
                        "time_window": None,
                    },
                },
                {
                    "kind": "fact",
                    "quote": "中聯油脂的大豆油驗出苯駢芘超標",
                    "normalized_statement": "發文內容稱中聯油脂的大豆油驗出苯駢芘超標",
                    "entities": [{"type": "supplier", "name": "中聯油脂"}],
                    "scope": {
                        "region": None,
                        "batch": None,
                        "time_window": None,
                    },
                },
            ],
            "fda_20260701": [
                {
                    "kind": "fact",
                    "quote": "中聯油脂批號 315-1150404 大豆沙拉油約 1,300 公噸苯駢芘 8.1 μg/kg，超過限量 2.0",
                    "normalized_statement": "公告稱中聯油脂批號 315-1150404 大豆沙拉油的苯駢芘濃度超過限量",
                    "entities": [{"type": "supplier", "name": "中聯油脂"}],
                    "scope": {
                        "region": None,
                        "batch": "315-1150404",
                        "time_window": None,
                    },
                }
            ],
            "fda_20260707": [
                {
                    "kind": "fact",
                    "quote": "擴大為所有使用受影響原料製成之食品，不論比例，7/8 24 時前全面下架",
                    "normalized_statement": "公告將所有使用受影響原料製成的食品納入全面下架範圍",
                    "entities": [],
                    "scope": {
                        "region": None,
                        "batch": None,
                        "time_window": None,
                    },
                }
            ],
            "cna_20260723": [
                {
                    "kind": "fact",
                    "quote": "19 批合格油品由泰山、福懋及福壽製成共 501 項產品，可重新上架",
                    "normalized_statement": "報導稱三家業者以 19 批合格油品製成的 501 項產品可重新上架",
                    "entities": [],
                    "scope": {
                        "region": None,
                        "batch": None,
                        "time_window": None,
                    },
                }
            ],
        }
        return {"claims": drafts[source.source_id]}


class LockCheckingVerificationProvider(FakeVerificationProvider):
    def __init__(self, db_path: str) -> None:
        super().__init__(
            [
                {
                    "verification_status": "supported",
                    "evidence_assessments": [
                        {
                            "evidence_id": "ev_s4_fda_20260701",
                            "stance": "supports",
                        }
                    ],
                },
                {
                    "verification_status": "supported",
                    "evidence_assessments": [
                        {
                            "evidence_id": "ev_s5_fda_20260707",
                            "stance": "supports",
                        }
                    ],
                },
                {
                    "verification_status": "insufficient_evidence",
                    "evidence_assessments": [
                        {
                            "evidence_id": "ev_s6_cna_20260723",
                            "stance": "context_only",
                        }
                    ],
                },
            ]
        )
        self.db_path = db_path

    async def assess(self, claim, evidence):
        _assert_write_lock_available(self.db_path)
        await asyncio.sleep(0)
        return await super().assess(claim, evidence)


class RecordingCaseDispatcher:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self.signal_ids: list[str] = []

    async def dispatch(self, signal_id: str) -> None:
        _assert_write_lock_available(self.db_path)
        await asyncio.sleep(0)
        self.signal_ids.append(signal_id)


@pytest.fixture
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Settings:
    for name in (
        "APP_ENV",
        "OPENAI_API_KEY",
        "RAILWAY_ENVIRONMENT_ID",
        "PUBLIC_ORIGIN",
    ):
        monkeypatch.delenv(name, raising=False)
    return replace(
        Settings.from_env(),
        db_path=str(tmp_path / "a-m1-acceptance.sqlite3"),
        session_secret="test-" * 10,
        session_cookie_secure=False,
        global_rate_limit_per_minute=100,
        public_origin="http://testserver",
    )


def _assert_write_lock_available(db_path: str) -> None:
    with sqlite3.connect(db_path, timeout=0.1) as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.rollback()


def _ingest_payload(source_input: SourceInput) -> dict[str, Any]:
    return source_input.model_dump(mode="json", exclude={"stage"})


def _post_ingest(
    client: TestClient, source_input: SourceInput, key: str
) -> Signal:
    response = client.post(
        "/api/v1/signals/ingest",
        json=_ingest_payload(source_input),
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 200, response.json()
    return Signal.model_validate(response.json())


def _post_verify(
    client: TestClient,
    claim_id: str,
    evidence_id: str,
    current_stage: int,
    key: str,
) -> tuple[Claim, dict[str, Any]]:
    response = client.post(
        f"/api/v1/claims/{claim_id}/verify",
        json={"evidence_ids": [evidence_id], "current_stage": current_stage},
        headers={"Idempotency-Key": key},
    )
    assert response.status_code == 200, response.json()
    return Claim.model_validate(response.json()), response.json()


def test_complete_six_stage_m1_pipeline_and_a_b_handoff(
    settings: Settings,
) -> None:
    store = SQLiteSignalStore(settings.db_path)
    draft_provider = PackDraftProvider(settings.db_path)
    claim_ids = (f"clm_acceptance_{number:03d}" for number in range(1, 10))
    extractor = ClaimExtractor(draft_provider, claim_id_factory=lambda: next(claim_ids))
    verification_provider = LockCheckingVerificationProvider(settings.db_path)
    verifier = ClaimVerificationService(verification_provider)
    dispatcher = RecordingCaseDispatcher(settings.db_path)
    application = create_app(
        settings,
        signal_store=store,
        claim_extractor=extractor,
        claim_verifier=verifier,
        case_dispatcher=dispatcher,
    )

    stages = {stage: load_sources(stage)[0] for stage in range(1, 7)}
    ingested: dict[int, Signal] = {}
    with TestClient(application) as client:
        ingested[1] = _post_ingest(client, stages[1], "stage-1-request")

        request_replay = _post_ingest(client, stages[1], "stage-1-request")
        source_replay = _post_ingest(client, stages[1], "stage-1-source-replay")
        assert request_replay == source_replay == ingested[1]
        assert draft_provider.calls == ["post_001"]
        assert dispatcher.signal_ids == [ingested[1].signal_id]

        for stage in (2, 3, 4):
            ingested[stage] = _post_ingest(
                client, stages[stage], f"stage-{stage}-request"
            )

        checkable_claim = next(
            claim for claim in ingested[3].claims if claim.kind == "fact"
        )
        original_claim_snapshot = checkable_claim.model_copy(deep=True)
        supported, supported_json = _post_verify(
            client,
            checkable_claim.claim_id,
            "ev_s4_fda_20260701",
            4,
            "verify-supported-request",
        )
        supported_replay, supported_replay_json = _post_verify(
            client,
            checkable_claim.claim_id,
            "ev_s4_fda_20260701",
            4,
            "verify-supported-request",
        )
        assert supported_replay == supported
        assert supported_replay_json == supported_json
        assert verification_provider.call_count == 1

        ingested[5] = _post_ingest(client, stages[5], "stage-5-request")
        stage_5_claim = ingested[5].claims[0]
        stage_5_supported, _ = _post_verify(
            client,
            stage_5_claim.claim_id,
            "ev_s5_fda_20260707",
            5,
            "verify-stage-5-supported-request",
        )
        ingested[6] = _post_ingest(client, stages[6], "stage-6-request")
        later_result, _ = _post_verify(
            client,
            checkable_claim.claim_id,
            "ev_s6_cna_20260723",
            6,
            "verify-insufficient-request",
        )

    assert [ingested[stage].source.source_id for stage in range(1, 7)] == [
        "post_001",
        "post_002",
        "post_003",
        "fda_20260701",
        "fda_20260707",
        "cna_20260723",
    ]
    assert dispatcher.signal_ids == [ingested[stage].signal_id for stage in range(1, 7)]
    assert draft_provider.calls == [
        "post_001",
        "post_003",
        "fda_20260701",
        "fda_20260707",
        "cna_20260723",
    ]

    repost = ingested[2]
    assert repost.source_relation == "repost"
    assert repost.duplicate_of_signal_id == ingested[1].signal_id
    assert repost.claims == []

    independent = ingested[3]
    assert independent.source_relation == "independent_report"
    assert independent.duplicate_of_signal_id is None
    assert [claim.kind for claim in independent.claims] == [
        "experience",
        "fact",
    ]
    assert independent.signal_id != ingested[1].signal_id

    assert supported.verification_status == "supported"
    assert [item.evidence_id for item in supported.evidence] == ["ev_s4_fda_20260701"]
    assert [item.stance for item in supported.evidence] == ["supports"]
    assert stage_5_supported.verification_status == "supported"
    assert [item.evidence_id for item in stage_5_supported.evidence] == [
        "ev_s5_fda_20260707"
    ]
    assert later_result.verification_status == "insufficient_evidence"
    assert [item.evidence_id for item in later_result.evidence] == [
        "ev_s6_cna_20260723"
    ]
    assert [item.stance for item in later_result.evidence] == ["context_only"]
    assert verification_provider.call_count == 3
    assert all(
        not hasattr(item, "claim_id") and not hasattr(item, "stance")
        for _, supplied_evidence in verification_provider.calls
        for item in supplied_evidence
    )

    for stage in range(1, 7):
        persisted = store.get_signal(ingested[stage].signal_id)
        assert persisted is not None
        assert persisted.source == ingested[stage].source
    assert store.get_signal(ingested[1].signal_id).source.raw_text == (
        stages[1].source.raw_text
    )
    assert original_claim_snapshot.verification_status == "insufficient_evidence"
    assert original_claim_snapshot.evidence == []
    current_claim = store.get_claim(checkable_claim.claim_id)
    assert current_claim is not None
    assert current_claim.verification_status == "insufficient_evidence"

    with store.connect() as connection:
        base_claim = Claim.model_validate_json(
            connection.execute(
                "SELECT claim_json FROM claims WHERE claim_id = ?",
                (checkable_claim.claim_id,),
            ).fetchone()["claim_json"]
        )
        attempts = connection.execute(
            """
            SELECT verification_attempt_id, verification_status
            FROM verification_attempts
            WHERE claim_id = ? ORDER BY verification_attempt_id
            """,
            (checkable_claim.claim_id,),
        ).fetchall()
        historical_evidence = [
            Evidence.model_validate_json(row["evidence_json"])
            for row in connection.execute(
                """
                SELECT evidence_json FROM evidence
                WHERE claim_id = ? ORDER BY verification_attempt_id
                """,
                (checkable_claim.claim_id,),
            )
        ]

    assert base_claim == original_claim_snapshot
    assert [row["verification_status"] for row in attempts] == [
        "supported",
        "insufficient_evidence",
    ]
    assert [item.evidence_id for item in historical_evidence] == [
        "ev_s4_fda_20260701",
        "ev_s6_cna_20260723",
    ]
