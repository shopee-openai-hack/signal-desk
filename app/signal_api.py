from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable, Sequence
from typing import Annotated, Protocol

from fastapi import APIRouter, Header, Path
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .claim_extraction import ClaimExtractionError, ClaimExtractorProtocol
from .claim_verification import (
    ClaimVerificationResult,
    VerificationProvider,
)
from .demo_loader import (
    DatasetReadError,
    DatasetValidationError,
    DemoDataError,
    EvidenceInput,
    EvidenceNotAvailableError,
    EvidenceNotFoundError,
    InvalidReplayStageError,
    SourceRecord,
)
from .schemas import Claim, Signal, Source, SourceRelation
from .signal_store import (
    DispatchInProgress,
    IdempotencyKeyConflict,
    IdempotentRequestInProgress,
    InvalidDispatchState,
    InvalidIngestionState,
    SourceReservation,
    SQLiteSignalStore,
    SignalStoreUnavailable,
)

logger = logging.getLogger(__name__)

INGEST_OPERATION = "signals.ingest"


class CaseDispatcherProtocol(Protocol):
    async def dispatch(self, signal_id: str) -> None:
        """Notify B that a newly analyzed canonical Signal is ready."""


class ClaimVerifierProtocol(Protocol):
    async def verify(
        self,
        claim: Claim,
        evidence: list[EvidenceInput],
    ) -> ClaimVerificationResult:
        """Return a pure verification result without performing persistence."""


class NoopCaseDispatcher:
    """Local composition placeholder until B injects its Case dispatcher."""

    async def dispatch(self, signal_id: str) -> None:
        del signal_id


class UnavailableClaimExtractor:
    """Explicit no-key behavior; callers may inject a deterministic demo extractor."""

    async def extract(self, signal_id: str, source: Source) -> list[Claim]:
        del signal_id, source
        raise ClaimExtractionError(
            "Claim extraction requires a configured backend provider."
        )


class UnavailableVerificationProvider(VerificationProvider):
    """Provider used without a key; the bounded verifier returns a safe failure."""

    async def assess(
        self,
        claim: Claim,
        evidence: Sequence[EvidenceInput],
    ) -> object:
        del claim, evidence
        raise RuntimeError("verification provider is not configured")


class SignalIngestRequest(BaseModel):
    """The source dataset item envelope without its replay-only stage field."""

    model_config = ConfigDict(extra="forbid")

    source: SourceRecord
    source_relation: SourceRelation
    duplicate_of_source_id: str | None


def _source_reservation(payload: SignalIngestRequest) -> SourceReservation:
    """Convert the HTTP input envelope to the canonical persistence command."""

    return SourceReservation(
        source=Source.model_validate(
            {
                **payload.source.model_dump(),
                "retrieval_status": "succeeded",
            }
        ),
        source_relation=payload.source_relation,
        duplicate_of_source_id=payload.duplicate_of_source_id,
    )


class VerifyClaimRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_ids: list[str]
    current_stage: int = Field(strict=True, ge=1)

    @field_validator("evidence_ids")
    @classmethod
    def evidence_ids_must_be_unique_and_non_empty(
        cls, value: list[str]
    ) -> list[str]:
        if any(not evidence_id.strip() for evidence_id in value):
            raise ValueError("Evidence IDs must not be empty")
        if len(value) != len(set(value)):
            raise ValueError("Evidence IDs must be unique")
        return value


class SignalAPIError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class SignalAPI:
    """A's HTTP application boundary with durable request idempotency."""

    def __init__(
        self,
        store: SQLiteSignalStore,
        extractor: ClaimExtractorProtocol,
        verifier: ClaimVerifierProtocol,
        evidence_loader: Callable[[list[str], int], list[EvidenceInput]],
        dispatcher: CaseDispatcherProtocol,
    ) -> None:
        self._store = store
        self._extractor = extractor
        self._verifier = verifier
        self._load_evidence = evidence_loader
        self._dispatcher = dispatcher

    async def ingest(
        self,
        payload: SignalIngestRequest,
        idempotency_key: str,
    ) -> JSONResponse:
        operation = INGEST_OPERATION
        request_hash = _request_hash(payload)
        replay = self._begin(operation, idempotency_key, request_hash)
        if replay is not None:
            return replay

        try:
            source_reservation = _source_reservation(payload)
            reservation = self._store.reserve_source(source_reservation)
            if reservation.requires_extraction:
                try:
                    claims = await self._extractor.extract(
                        reservation.signal_id,
                        source_reservation.source,
                    )
                except Exception as exc:  # noqa: BLE001 - API error is sanitized
                    self._store.fail_extraction(
                        reservation.signal_id,
                        "Claim extraction failed after bounded attempts.",
                    )
                    raise SignalAPIError(
                        "claim_extraction_failed",
                        "Claim extraction failed; the Signal was retained for review.",
                        502,
                    ) from exc
                signal = self._store.complete_signal(
                    reservation.signal_id,
                    claims,
                )
            else:
                signal = self._store.get_signal(reservation.signal_id)
                if signal is None:
                    raise SignalStoreUnavailable(
                        "Reserved Signal could not be reconstructed"
                    )

            # The durable lifecycle is authoritative even for a repeated source.
            # That distinction lets a failed dispatch retry while a completed one
            # remains a no-op.
            try:
                dispatch_reservation = self._store.begin_dispatch(
                    signal.signal_id
                )
            except DispatchInProgress as exc:
                raise SignalAPIError(
                    "dispatch_in_progress",
                    "This Signal is already being dispatched.",
                    409,
                ) from exc
            except InvalidDispatchState as exc:
                raise SignalAPIError(
                    "signal_not_dispatchable",
                    "This Signal is not ready for Case dispatch.",
                    409,
                ) from exc

            if not dispatch_reservation.should_dispatch:
                return self._complete(
                    operation,
                    idempotency_key,
                    request_hash,
                    signal.model_dump_json(),
                    200,
                )
            try:
                await self._dispatcher.dispatch(signal.signal_id)
            except Exception as exc:  # noqa: BLE001 - external details stay private
                self._store.abort_dispatch(signal.signal_id)
                raise SignalAPIError(
                    "case_dispatch_failed",
                    "The Signal was stored but could not be dispatched to a Case.",
                    502,
                ) from exc
            self._store.complete_dispatch(signal.signal_id)

            return self._complete(
                operation,
                idempotency_key,
                request_hash,
                signal.model_dump_json(),
                200,
            )
        except SignalAPIError as exc:
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(exc)
        except InvalidIngestionState:
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(
                SignalAPIError(
                    "invalid_source_relation",
                    "The source relationship is not valid for this Signal.",
                    409,
                )
            )
        except SignalStoreUnavailable:
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(_database_error())
        except Exception as exc:  # noqa: BLE001 - avoid leaking implementation data
            self._abort(operation, idempotency_key, request_hash)
            logger.warning("unexpected Signal ingestion failure: %s", type(exc).__name__)
            return _error_response(
                SignalAPIError(
                    "signal_ingestion_failed",
                    "The Signal could not be ingested.",
                    500,
                )
            )

    async def verify_claim(
        self,
        claim_id: str,
        payload: VerifyClaimRequest,
        idempotency_key: str,
    ) -> JSONResponse:
        operation = f"claims.verify:{claim_id}"
        request_hash = _request_hash(payload)
        replay = self._begin(operation, idempotency_key, request_hash)
        if replay is not None:
            return replay

        try:
            claim = self._store.get_claim(claim_id)
            if claim is None:
                raise SignalAPIError(
                    "claim_not_found",
                    "The requested Claim does not exist.",
                    404,
                )
            evidence = self._load_evidence(
                payload.evidence_ids,
                payload.current_stage,
            )
            result = await self._verifier.verify(claim, evidence)
            updated_claim = self._store.append_verification(claim_id, result)
            if result.sanitized_failure is not None:
                raise SignalAPIError(
                    "claim_verification_failed",
                    "Claim verification failed after bounded attempts.",
                    502,
                )

            return self._complete(
                operation,
                idempotency_key,
                request_hash,
                updated_claim.model_dump_json(),
                200,
            )
        except SignalAPIError as exc:
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(exc)
        except EvidenceNotFoundError:
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(
                SignalAPIError(
                    "evidence_not_found",
                    "One or more requested Evidence items do not exist.",
                    404,
                )
            )
        except EvidenceNotAvailableError:
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(
                SignalAPIError(
                    "evidence_not_available",
                    "One or more requested Evidence items are not available yet.",
                    409,
                )
            )
        except InvalidReplayStageError:
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(
                SignalAPIError(
                    "invalid_replay_stage",
                    "Replay stage must be a positive integer.",
                    422,
                )
            )
        except (DatasetReadError, DatasetValidationError):
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(
                SignalAPIError(
                    "demo_data_unavailable",
                    "The synthesized Evidence dataset is unavailable.",
                    503,
                )
            )
        except DemoDataError:
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(
                SignalAPIError(
                    "invalid_evidence_request",
                    "The synthesized Evidence request is invalid.",
                    422,
                )
            )
        except (InvalidIngestionState, SignalStoreUnavailable):
            self._abort(operation, idempotency_key, request_hash)
            return _error_response(_database_error())
        except Exception as exc:  # noqa: BLE001 - avoid leaking implementation data
            self._abort(operation, idempotency_key, request_hash)
            logger.warning("unexpected Claim verification failure: %s", type(exc).__name__)
            return _error_response(
                SignalAPIError(
                    "claim_verification_failed",
                    "Claim verification failed.",
                    502,
                )
            )

    def _begin(
        self,
        operation: str,
        key: str,
        request_hash: str,
    ) -> JSONResponse | None:
        try:
            reservation = self._store.begin_idempotent_request(
                operation,
                key,
                request_hash,
            )
        except IdempotencyKeyConflict:
            return _error_response(
                SignalAPIError(
                    "idempotency_key_reused",
                    "The Idempotency-Key was already used for a different request.",
                    409,
                )
            )
        except IdempotentRequestInProgress:
            return _error_response(
                SignalAPIError(
                    "idempotency_in_progress",
                    "An identical request with this Idempotency-Key is still running.",
                    409,
                )
            )
        except SignalStoreUnavailable:
            return _error_response(_database_error())
        except ValueError:
            return _error_response(
                SignalAPIError(
                    "invalid_idempotency_key",
                    "Idempotency-Key must contain a non-whitespace value.",
                    422,
                )
            )

        if not reservation.is_replay:
            return None
        if reservation.response_json is None or reservation.response_status is None:
            return _error_response(_database_error())
        return JSONResponse(
            status_code=reservation.response_status,
            content=json.loads(reservation.response_json),
        )

    def _complete(
        self,
        operation: str,
        key: str,
        request_hash: str,
        response_json: str,
        response_status: int,
    ) -> JSONResponse:
        completed = self._store.complete_idempotent_request(
            operation,
            key,
            request_hash,
            response_json,
            response_status,
        )
        assert completed.response_json is not None
        assert completed.response_status is not None
        return JSONResponse(
            status_code=completed.response_status,
            content=json.loads(completed.response_json),
        )

    def _abort(self, operation: str, key: str, request_hash: str) -> None:
        try:
            self._store.abort_idempotent_request(operation, key, request_hash)
        except Exception as exc:  # noqa: BLE001 - preserve the primary safe response
            logger.warning("idempotency abort failed: %s", type(exc).__name__)


def create_signal_router(application: SignalAPI) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    @router.post("/signals/ingest", response_model=Signal, status_code=200)
    async def ingest_signal(
        payload: SignalIngestRequest,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=255),
        ],
    ) -> JSONResponse:
        return await application.ingest(payload, idempotency_key)

    @router.post("/claims/{claim_id}/verify", response_model=Claim, status_code=200)
    async def verify_claim(
        payload: VerifyClaimRequest,
        idempotency_key: Annotated[
            str,
            Header(alias="Idempotency-Key", min_length=1, max_length=255),
        ],
        claim_id: Annotated[str, Path(min_length=1)],
    ) -> JSONResponse:
        return await application.verify_claim(claim_id, payload, idempotency_key)

    return router


def _request_hash(payload: BaseModel) -> str:
    canonical = json.dumps(
        payload.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _database_error() -> SignalAPIError:
    return SignalAPIError(
        "database_unavailable",
        "Signal data is temporarily unavailable.",
        503,
    )


def _error_response(error: SignalAPIError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "error": {
                "code": error.code,
                "message": error.message,
                "details": {},
            }
        },
    )


__all__ = [
    "CaseDispatcherProtocol",
    "ClaimVerifierProtocol",
    "NoopCaseDispatcher",
    "SignalAPI",
    "SignalIngestRequest",
    "UnavailableClaimExtractor",
    "UnavailableVerificationProvider",
    "VerifyClaimRequest",
    "create_signal_router",
]
