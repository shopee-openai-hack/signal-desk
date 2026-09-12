from __future__ import annotations

from typing import Any, Protocol

from .schemas import Claim, Signal, Source
from .signal_store import (
    DispatchReservation,
    IdempotentRequestReservation,
    IngestionReservation,
    SourceReservation,
    SQLiteSignalStore,
    VerificationResultLike,
)


class SourceInputLike(Protocol):
    source: Any
    source_relation: str
    duplicate_of_source_id: str | None


class SignalIngestionService:
    """Application boundary that keeps extraction outside SQLite transactions."""

    def __init__(self, store: SQLiteSignalStore) -> None:
        self.store = store

    def reserve_source(self, source_input: SourceInputLike) -> IngestionReservation:
        source_payload = source_input.source.model_dump()
        source_payload.setdefault("retrieval_status", "succeeded")
        request = SourceReservation(
            source=Source.model_validate(source_payload),
            source_relation=source_input.source_relation,  # type: ignore[arg-type]
            duplicate_of_source_id=source_input.duplicate_of_source_id,
        )
        return self.store.reserve_source(request)

    def complete_signal(self, signal_id: str, claims: list[Claim]) -> Signal:
        return self.store.complete_signal(signal_id, claims)

    def fail_extraction(self, signal_id: str, sanitized_error: str) -> None:
        self.store.fail_extraction(signal_id, sanitized_error)

    def get_signal(self, signal_id: str) -> Signal | None:
        return self.store.get_signal(signal_id)

    def get_claim(self, claim_id: str) -> Claim | None:
        return self.store.get_claim(claim_id)

    def append_verification(
        self, claim_id: str, result: VerificationResultLike
    ) -> Claim:
        return self.store.append_verification(claim_id, result)

    def begin_idempotent_request(
        self, operation: str, key: str, request_hash: str
    ) -> IdempotentRequestReservation:
        return self.store.begin_idempotent_request(operation, key, request_hash)

    def complete_idempotent_request(
        self,
        operation: str,
        key: str,
        request_hash: str,
        response_json: str,
        response_status: int,
    ) -> IdempotentRequestReservation:
        return self.store.complete_idempotent_request(
            operation, key, request_hash, response_json, response_status
        )

    def abort_idempotent_request(
        self, operation: str, key: str, request_hash: str
    ) -> None:
        self.store.abort_idempotent_request(operation, key, request_hash)

    def begin_dispatch(self, signal_id: str) -> DispatchReservation:
        return self.store.begin_dispatch(signal_id)

    def complete_dispatch(self, signal_id: str) -> None:
        self.store.complete_dispatch(signal_id)

    def abort_dispatch(self, signal_id: str) -> None:
        self.store.abort_dispatch(signal_id)


IngestionService = SignalIngestionService
