from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.demo_loader import load_sources
from app.ingestion import SignalIngestionService
from app.schemas import Claim, ClaimScope, Entity, Evidence, VerificationStatus
from app.signal_store import (
    IdempotencyKeyConflict,
    IdempotentRequestInProgress,
    SQLiteSignalStore,
)


def _service(path: Path) -> SignalIngestionService:
    store = SQLiteSignalStore(path)
    store.init_schema()
    return SignalIngestionService(store)


def _claim(signal_id: str, claim_id: str = "clm_oil_001") -> Claim:
    return Claim(
        claim_id=claim_id,
        signal_id=signal_id,
        kind="experience",
        quote="Demo 牌 B123 批次食用油有怪味",
        normalized_statement="A user reports an unusual smell in Demo Brand batch B123 oil",
        entities=[Entity(type="brand", name="Demo")],
        scope=ClaimScope(region=None, batch="B123", time_window=None),
        verification_status="not_applicable",
        evidence=[],
    )


@dataclass(frozen=True)
class _VerificationResult:
    verification_status: VerificationStatus | None
    evidence: list[Evidence]
    attempt_count: int
    sanitized_failure: str | None = None


def test_reserve_then_complete_round_trips_across_repository_instances(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "signals.sqlite3"
    service = _service(db_path)
    reservation = service.reserve_source(load_sources(1)[0])

    assert reservation.is_new
    assert reservation.requires_extraction
    assert reservation.requires_dispatch
    completed = service.complete_signal(
        reservation.signal_id, [_claim(reservation.signal_id)]
    )

    fresh = _service(db_path)
    restored = fresh.get_signal(reservation.signal_id)
    assert restored == completed
    assert restored is not None
    assert restored.claims[0].claim_id == "clm_oil_001"


def test_repeated_source_identity_skips_extraction_and_dispatch(tmp_path: Path) -> None:
    service = _service(tmp_path / "signals.sqlite3")
    source = load_sources(1)[0]
    first = service.reserve_source(source)
    service.complete_signal(first.signal_id, [_claim(first.signal_id)])

    repeated = service.reserve_source(source)

    assert repeated.signal_id == first.signal_id
    assert not repeated.is_new
    assert not repeated.requires_extraction
    assert not repeated.requires_dispatch
    assert service.get_signal(repeated.signal_id) is not None


def test_concurrent_reservations_create_one_canonical_signal(tmp_path: Path) -> None:
    db_path = tmp_path / "signals.sqlite3"
    _service(db_path)
    source = load_sources(1)[0]

    def reserve(_: int):
        return SignalIngestionService(SQLiteSignalStore(db_path)).reserve_source(source)

    with ThreadPoolExecutor(max_workers=8) as executor:
        reservations = list(executor.map(reserve, range(16)))

    assert len({item.signal_id for item in reservations}) == 1
    assert sum(item.is_new for item in reservations) == 1
    assert sum(item.requires_extraction for item in reservations) == 1
    assert sum(item.requires_dispatch for item in reservations) == 1


def test_pure_repost_is_a_new_completed_signal_without_claims(tmp_path: Path) -> None:
    service = _service(tmp_path / "signals.sqlite3")
    original_reservation = service.reserve_source(load_sources(1)[0])
    original = service.complete_signal(
        original_reservation.signal_id, [_claim(original_reservation.signal_id)]
    )

    repost_reservation = service.reserve_source(load_sources(2)[0])
    repost = service.get_signal(repost_reservation.signal_id)

    assert repost_reservation.is_new
    assert not repost_reservation.requires_extraction
    assert repost_reservation.requires_dispatch
    assert repost is not None
    assert repost.source_relation == "repost"
    assert repost.duplicate_of_signal_id == original.signal_id
    assert repost.claims == []


def test_identical_text_with_a_distinct_identity_is_retained(tmp_path: Path) -> None:
    service = _service(tmp_path / "signals.sqlite3")
    original_input = load_sources(1)[0]
    independent_input = load_sources(3)[0]
    independent_input = independent_input.model_copy(
        update={
            "source": independent_input.source.model_copy(
                update={"raw_text": original_input.source.raw_text}
            )
        }
    )

    first = service.reserve_source(original_input)
    second = service.reserve_source(independent_input)

    assert first.signal_id != second.signal_id
    assert first.is_new and second.is_new
    assert second.requires_extraction


def test_failed_extraction_preserves_source_and_is_idempotent(tmp_path: Path) -> None:
    service = _service(tmp_path / "signals.sqlite3")
    reservation = service.reserve_source(load_sources(1)[0])

    service.fail_extraction(reservation.signal_id, "provider failed after two attempts")
    service.fail_extraction(reservation.signal_id, "provider failed after two attempts")

    restored = service.get_signal(reservation.signal_id)
    repeated = service.reserve_source(load_sources(1)[0])
    assert restored is not None
    assert restored.source.raw_text == load_sources(1)[0].source.raw_text
    assert restored.claims == []
    assert repeated.signal_id == reservation.signal_id
    assert not repeated.requires_extraction


def test_verification_history_is_append_only_and_latest_success_is_canonical(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "signals.sqlite3"
    service = _service(db_path)
    reservation = service.reserve_source(load_sources(1)[0])
    initial_claim = _claim(reservation.signal_id)
    service.complete_signal(reservation.signal_id, [initial_claim])
    evidence = Evidence(
        evidence_id="ev_support_001",
        claim_id=initial_claim.claim_id,
        url="https://example.test/evidence/support",
        title="Synthesized support",
        publisher="Fictional authority",
        published_at="2026-09-12T03:00:00Z",
        retrieved_at="2026-09-12T03:01:00Z",
        excerpt="The sample did not meet the fictional standard.",
        stance="supports",
    )

    supported = service.append_verification(
        initial_claim.claim_id,
        _VerificationResult("supported", [evidence], attempt_count=1),
    )
    failed = service.append_verification(
        initial_claim.claim_id,
        _VerificationResult(
            None,
            [],
            attempt_count=2,
            sanitized_failure="provider unavailable",
        ),
    )

    assert supported.verification_status == "supported"
    assert failed == supported
    restored = _service(db_path).get_claim(initial_claim.claim_id)
    assert restored == supported

    with SQLiteSignalStore(db_path).connect() as connection:
        attempts = connection.execute(
            """
            SELECT status, model_attempt_count, sanitized_failure
            FROM verification_attempts ORDER BY verification_attempt_id
            """
        ).fetchall()
        stored_evidence = connection.execute(
            "SELECT evidence_id FROM evidence"
        ).fetchall()
    assert [row["status"] for row in attempts] == ["succeeded", "failed"]
    assert attempts[1]["model_attempt_count"] == 2
    assert attempts[1]["sanitized_failure"] == "provider unavailable"
    assert [row["evidence_id"] for row in stored_evidence] == ["ev_support_001"]


def test_later_success_replaces_canonical_view_without_deleting_history(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "signals.sqlite3"
    service = _service(db_path)
    reservation = service.reserve_source(load_sources(1)[0])
    claim = _claim(reservation.signal_id)
    service.complete_signal(reservation.signal_id, [claim])
    support = Evidence(
        evidence_id="ev_support",
        claim_id=claim.claim_id,
        url="https://example.test/support",
        title="Support",
        publisher="Fictional authority",
        published_at="2026-09-12T03:00:00Z",
        retrieved_at="2026-09-12T03:01:00Z",
        excerpt="Supports the claim.",
        stance="supports",
    )
    refute = Evidence(
        evidence_id="ev_refute",
        claim_id=claim.claim_id,
        url="https://example.test/refute",
        title="Correction",
        publisher="Fictional authority",
        published_at="2026-09-12T04:00:00Z",
        retrieved_at="2026-09-12T04:01:00Z",
        excerpt="Refutes the claim.",
        stance="refutes",
    )

    service.append_verification(
        claim.claim_id, _VerificationResult("supported", [support], 1)
    )
    current = service.append_verification(
        claim.claim_id, _VerificationResult("refuted", [refute], 1)
    )

    assert current.verification_status == "refuted"
    assert [item.evidence_id for item in current.evidence] == ["ev_refute"]
    with SQLiteSignalStore(db_path).connect() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM verification_attempts"
        ).fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM evidence").fetchone()[0] == 2


def test_zero_model_attempt_verification_can_be_persisted(tmp_path: Path) -> None:
    service = _service(tmp_path / "signals.sqlite3")
    reservation = service.reserve_source(load_sources(1)[0])
    claim = _claim(reservation.signal_id)
    service.complete_signal(reservation.signal_id, [claim])

    current = service.append_verification(
        claim.claim_id,
        _VerificationResult("not_applicable", [], attempt_count=0),
    )

    assert current.verification_status == "not_applicable"
    assert current.evidence == []


def test_completed_idempotent_request_replays_persisted_response(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "signals.sqlite3"
    service = _service(db_path)

    claimed = service.begin_idempotent_request("verify", "key-001", "hash-a")
    completed = service.complete_idempotent_request(
        "verify",
        "key-001",
        "hash-a",
        '{"claim_id":"clm_001","verification_status":"supported"}',
        200,
    )
    replay = _service(db_path).begin_idempotent_request(
        "verify", "key-001", "hash-a"
    )

    assert claimed.is_new and not claimed.is_replay
    assert completed.is_replay
    assert replay.is_replay
    assert replay.response_status == 200
    assert replay.response_json == (
        '{"claim_id":"clm_001","verification_status":"supported"}'
    )


def test_idempotency_key_with_different_request_hash_conflicts(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path / "signals.sqlite3")
    service.begin_idempotent_request("ingest", "same-key", "hash-a")

    with pytest.raises(IdempotencyKeyConflict) as exc_info:
        service.begin_idempotent_request("ingest", "same-key", "hash-b")

    assert exc_info.value.code == "idempotency_key_reused"


def test_matching_pending_idempotent_request_reports_in_progress(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path / "signals.sqlite3")
    service.begin_idempotent_request("verify", "pending-key", "hash-a")

    with pytest.raises(IdempotentRequestInProgress) as exc_info:
        service.begin_idempotent_request("verify", "pending-key", "hash-a")

    assert exc_info.value.code == "idempotency_in_progress"


def test_aborted_request_can_be_claimed_for_an_explicit_retry(tmp_path: Path) -> None:
    service = _service(tmp_path / "signals.sqlite3")
    service.begin_idempotent_request("verify", "retry-key", "hash-a")

    service.abort_idempotent_request("verify", "retry-key", "hash-a")
    retry = service.begin_idempotent_request("verify", "retry-key", "hash-a")

    assert retry.is_new
    assert retry.response_json is None
    assert retry.response_status is None
