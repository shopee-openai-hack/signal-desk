from __future__ import annotations

import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.claim_extraction import ClaimExtractionError
from app.claim_verification import (
    ClaimVerificationService,
    FakeVerificationProvider,
)
from app.config import Settings
from app.main import create_app
from app.schemas import Claim, ClaimScope, Source


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
        db_path=str(tmp_path / "signal-api.sqlite3"),
        session_secret="test-" * 10,
        session_cookie_secure=False,
        global_rate_limit_per_minute=100,
        public_origin="http://testserver",
    )


class FakeClaimExtractor:
    def __init__(
        self,
        *,
        kind: str = "fact",
        failure: Exception | None = None,
        lock_path: str | None = None,
    ) -> None:
        self.kind = kind
        self.failure = failure
        self.lock_path = lock_path
        self.calls: list[tuple[str, Source]] = []

    async def extract(self, signal_id: str, source: Source) -> list[Claim]:
        self.calls.append((signal_id, source))
        if self.lock_path is not None:
            _assert_write_lock_available(self.lock_path)
        if self.failure is not None:
            raise self.failure
        status = (
            "insufficient_evidence"
            if self.kind in {"fact", "hypothesis"}
            else "not_applicable"
        )
        return [
            Claim(
                claim_id=f"clm_{source.source_id}",
                signal_id=signal_id,
                kind=self.kind,
                quote=source.raw_text,
                normalized_statement=source.raw_text,
                entities=[],
                scope=ClaimScope(region=None, batch=None, time_window=None),
                verification_status=status,
                evidence=[],
            )
        ]


class RecordingDispatcher:
    def __init__(
        self,
        failure: Exception | None = None,
        *,
        lock_path: str | None = None,
    ) -> None:
        self.failure = failure
        self.lock_path = lock_path
        self.signal_ids: list[str] = []

    async def dispatch(self, signal_id: str) -> None:
        self.signal_ids.append(signal_id)
        if self.lock_path is not None:
            _assert_write_lock_available(self.lock_path)
        if self.failure is not None:
            raise self.failure


class LockCheckingVerificationProvider(FakeVerificationProvider):
    def __init__(self, lock_path: str, responses: list[object]) -> None:
        super().__init__(responses)  # type: ignore[arg-type]
        self.lock_path = lock_path

    async def assess(self, claim, evidence):
        _assert_write_lock_available(self.lock_path)
        return await super().assess(claim, evidence)


def _source_payload(
    source_id: str,
    *,
    relation: str = "original",
    duplicate_of_source_id: str | None = None,
    raw_text: str = "Demo 牌 B123 批次食用油可能有問題",
) -> dict[str, object]:
    return {
        "source": {
            "provider": "synthesized",
            "source_id": source_id,
            "url": f"https://example.test/synthesized/{source_id}",
            "author_ref": "fictional_user",
            "published_at": "2026-09-12T01:55:00Z",
            "retrieved_at": "2026-09-12T02:00:00Z",
            "raw_text": raw_text,
        },
        "source_relation": relation,
        "duplicate_of_source_id": duplicate_of_source_id,
    }


def _headers(key: str) -> dict[str, str]:
    return {"Idempotency-Key": key}


def _assert_write_lock_available(path: str) -> None:
    with sqlite3.connect(path, timeout=0.1) as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.rollback()


def test_ingest_success_and_both_idempotency_layers(
    settings: Settings,
) -> None:
    extractor = FakeClaimExtractor(lock_path=settings.db_path)
    dispatcher = RecordingDispatcher(lock_path=settings.db_path)
    application = create_app(
        settings,
        claim_extractor=extractor,
        case_dispatcher=dispatcher,
    )
    payload = _source_payload("post_api_001")

    with TestClient(application) as client:
        created = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("ingest-key-1"),
        )
        request_replay = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("ingest-key-1"),
        )
        source_replay = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("ingest-key-2"),
        )

    assert created.status_code == 200
    assert request_replay.status_code == 200
    assert source_replay.status_code == 200
    assert request_replay.json() == created.json() == source_replay.json()
    assert created.json()["claims"][0]["signal_id"] == created.json()["signal_id"]
    assert created.json()["source"]["retrieval_status"] == "succeeded"
    assert len(extractor.calls) == 1
    assert dispatcher.signal_ids == [created.json()["signal_id"]]


def test_completed_request_replays_durably_across_app_instances(
    settings: Settings,
) -> None:
    payload = _source_payload("post_durable_001")
    first_extractor = FakeClaimExtractor()
    first_dispatcher = RecordingDispatcher()
    with TestClient(
        create_app(
            settings,
            claim_extractor=first_extractor,
            case_dispatcher=first_dispatcher,
        )
    ) as client:
        first = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("durable-key"),
        )

    replay_extractor = FakeClaimExtractor(failure=AssertionError("must not run"))
    replay_dispatcher = RecordingDispatcher(AssertionError("must not run"))
    with TestClient(
        create_app(
            settings,
            claim_extractor=replay_extractor,
            case_dispatcher=replay_dispatcher,
        )
    ) as client:
        replay = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("durable-key"),
        )

    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json()
    assert replay_extractor.calls == []
    assert replay_dispatcher.signal_ids == []


def test_idempotency_key_conflict_is_409(settings: Settings) -> None:
    application = create_app(
        settings,
        claim_extractor=FakeClaimExtractor(),
        case_dispatcher=RecordingDispatcher(),
    )
    with TestClient(application) as client:
        first = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_conflict_001"),
            headers=_headers("reused-key"),
        )
        conflict = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_conflict_002"),
            headers=_headers("reused-key"),
        )

    assert first.status_code == 200
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "idempotency_key_reused"


def test_pure_repost_is_persisted_and_dispatched_without_extraction(
    settings: Settings,
) -> None:
    extractor = FakeClaimExtractor(kind="experience")
    dispatcher = RecordingDispatcher()
    application = create_app(
        settings,
        claim_extractor=extractor,
        case_dispatcher=dispatcher,
    )
    with TestClient(application) as client:
        original = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_original"),
            headers=_headers("original-key"),
        )
        repost = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload(
                "post_repost",
                relation="repost",
                duplicate_of_source_id="post_original",
                raw_text="【合成示範資料／純轉貼】post_original",
            ),
            headers=_headers("repost-key"),
        )

    assert original.status_code == repost.status_code == 200
    assert repost.json()["source_relation"] == "repost"
    assert repost.json()["duplicate_of_signal_id"] == original.json()["signal_id"]
    assert repost.json()["claims"] == []
    assert len(extractor.calls) == 1
    assert dispatcher.signal_ids == [
        original.json()["signal_id"],
        repost.json()["signal_id"],
    ]


def test_extraction_failure_is_retained_and_never_dispatched(
    settings: Settings,
) -> None:
    extractor = FakeClaimExtractor(
        failure=ClaimExtractionError("private model detail")
    )
    dispatcher = RecordingDispatcher()
    application = create_app(
        settings,
        claim_extractor=extractor,
        case_dispatcher=dispatcher,
    )

    with TestClient(application) as client:
        response = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_extract_fail"),
            headers=_headers("extract-fail-key"),
        )
        retry = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_extract_fail"),
            headers=_headers("extract-fail-retry-key"),
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "claim_extraction_failed"
    assert "private" not in response.text
    assert retry.status_code == 409
    assert retry.json()["error"]["code"] == "signal_not_dispatchable"
    assert dispatcher.signal_ids == []
    with sqlite3.connect(settings.db_path) as connection:
        status = connection.execute(
            "SELECT ingestion_status FROM signals WHERE source_id = ?",
            ("post_extract_fail",),
        ).fetchone()[0]
    assert status == "extraction_failed"


def test_dispatch_failure_is_not_reported_as_success(settings: Settings) -> None:
    extractor = FakeClaimExtractor()
    dispatcher = RecordingDispatcher(RuntimeError("private B detail"))
    application = create_app(
        settings,
        claim_extractor=extractor,
        case_dispatcher=dispatcher,
    )

    with TestClient(application) as client:
        response = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_dispatch_fail"),
            headers=_headers("dispatch-fail-key"),
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "case_dispatch_failed"
    assert "private" not in response.text
    assert len(dispatcher.signal_ids) == 1
    assert application.state.signal_store.get_signal(dispatcher.signal_ids[0]) is not None


def test_failed_dispatch_retries_durably_then_success_does_not_duplicate(
    settings: Settings,
) -> None:
    extractor = FakeClaimExtractor()
    dispatcher = RecordingDispatcher(RuntimeError("temporary B failure"))
    application = create_app(
        settings,
        claim_extractor=extractor,
        case_dispatcher=dispatcher,
    )
    payload = _source_payload("post_dispatch_retry")

    with TestClient(application) as client:
        failed = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("dispatch-retry-key"),
        )
        signal_id = dispatcher.signal_ids[0]
        application.state.signal_store.begin_dispatch(signal_id)
        in_progress = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("dispatch-retry-key"),
        )
        application.state.signal_store.abort_dispatch(signal_id)
        dispatcher.failure = None
        retried = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("dispatch-retry-key"),
        )
        request_replay = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("dispatch-retry-key"),
        )
        source_replay = client.post(
            "/api/v1/signals/ingest",
            json=payload,
            headers=_headers("dispatch-retry-new-key"),
        )

    assert failed.status_code == 502
    assert in_progress.status_code == 409
    assert in_progress.json()["error"]["code"] == "dispatch_in_progress"
    assert (
        retried.status_code
        == request_replay.status_code
        == source_replay.status_code
        == 200
    )
    assert retried.json() == request_replay.json() == source_replay.json()
    assert len(extractor.calls) == 1
    assert dispatcher.signal_ids == [
        retried.json()["signal_id"],
        retried.json()["signal_id"],
    ]


def test_verify_persists_canonical_evidence_and_replays_without_model_call(
    settings: Settings,
) -> None:
    provider = LockCheckingVerificationProvider(
        settings.db_path,
        [
            {
                "verification_status": "supported",
                "evidence_assessments": [
                    {
                        "evidence_id": "ev_s4_fda_20260701",
                        "stance": "supports",
                    }
                ],
            }
        ]
    )
    verifier = ClaimVerificationService(provider)
    application = create_app(
        settings,
        claim_extractor=FakeClaimExtractor(),
        claim_verifier=verifier,
        case_dispatcher=RecordingDispatcher(),
    )

    with TestClient(application) as client:
        ingested = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_verify_001"),
            headers=_headers("verify-ingest-key"),
        )
        claim_id = ingested.json()["claims"][0]["claim_id"]
        verification_payload = {
            "evidence_ids": ["ev_s4_fda_20260701"],
            "current_stage": 4,
        }
        verified = client.post(
            f"/api/v1/claims/{claim_id}/verify",
            json=verification_payload,
            headers=_headers("verify-key"),
        )
        replay = client.post(
            f"/api/v1/claims/{claim_id}/verify",
            json=verification_payload,
            headers=_headers("verify-key"),
        )

    assert verified.status_code == replay.status_code == 200
    assert verified.json() == replay.json()
    assert verified.json()["verification_status"] == "supported"
    assert verified.json()["evidence"][0]["claim_id"] == claim_id
    assert provider.call_count == 1


def test_verification_failure_and_future_evidence_are_not_false_successes(
    settings: Settings,
) -> None:
    provider = FakeVerificationProvider(
        [RuntimeError("private provider data"), RuntimeError("more private data")]
    )
    application = create_app(
        settings,
        claim_extractor=FakeClaimExtractor(),
        claim_verifier=ClaimVerificationService(provider),
        case_dispatcher=RecordingDispatcher(),
    )

    with TestClient(application) as client:
        ingested = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_verify_fail"),
            headers=_headers("failure-ingest-key"),
        )
        claim_id = ingested.json()["claims"][0]["claim_id"]
        future = client.post(
            f"/api/v1/claims/{claim_id}/verify",
            json={
                "evidence_ids": ["ev_s6_cna_20260723"],
                "current_stage": 4,
            },
            headers=_headers("future-evidence-key"),
        )
        failed = client.post(
            f"/api/v1/claims/{claim_id}/verify",
            json={
                "evidence_ids": ["ev_s4_fda_20260701"],
                "current_stage": 4,
            },
            headers=_headers("failed-verification-key"),
        )

    assert future.status_code == 409
    assert future.json()["error"]["code"] == "evidence_not_available"
    assert failed.status_code == 502
    assert failed.json()["error"]["code"] == "claim_verification_failed"
    assert "private" not in failed.text
    assert provider.call_count == 2


def test_signal_write_endpoints_require_exact_json_and_idempotency_header(
    settings: Settings,
) -> None:
    application = create_app(
        settings,
        claim_extractor=FakeClaimExtractor(),
        case_dispatcher=RecordingDispatcher(),
    )
    with TestClient(application) as client:
        missing_key = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_missing_key"),
        )
        extra_field = client.post(
            "/api/v1/signals/ingest",
            json={**_source_payload("post_extra"), "stage": 1},
            headers=_headers("extra-key"),
        )
        wrong_content_type = client.post(
            "/api/v1/signals/ingest",
            content="{}",
            headers={"Idempotency-Key": "content-key"},
        )
        whitespace_key = client.post(
            "/api/v1/signals/ingest",
            json=_source_payload("post_whitespace_key"),
            headers=_headers("   "),
        )

    assert missing_key.status_code == 422
    assert missing_key.json()["error"]["code"] == "invalid_request"
    assert extra_field.status_code == 422
    assert wrong_content_type.status_code == 415
    assert whitespace_key.status_code == 422
    assert whitespace_key.json()["error"]["code"] == "invalid_idempotency_key"
    source_schema = application.openapi()["components"]["schemas"][
        "SignalIngestRequest"
    ]["properties"]["source"]
    assert source_schema["$ref"].endswith("/SourceRecord")
