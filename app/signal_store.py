from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Protocol, Sequence
from uuid import uuid4

from pydantic import ValidationError

from .schemas import Claim, Evidence, Signal, Source, SourceRelation, VerificationStatus


class SignalStoreError(RuntimeError):
    """Base class for expected signal persistence failures."""


class SignalStoreUnavailable(SignalStoreError):
    """SQLite could not complete the requested operation."""


class InvalidIngestionState(SignalStoreError):
    """The requested transition is not valid for the persisted Signal."""


class IdempotencyKeyConflict(SignalStoreError):
    """An operation reused an idempotency key for a different request."""

    code = "idempotency_key_reused"


class IdempotentRequestInProgress(SignalStoreError):
    """A matching request currently owns the operation/key reservation."""

    code = "idempotency_in_progress"


class InvalidIdempotencyState(SignalStoreError):
    """An idempotent request completion does not match a pending claim."""


@dataclass(frozen=True)
class SourceReservation:
    source: Source
    source_relation: SourceRelation
    duplicate_of_source_id: str | None


@dataclass(frozen=True)
class IngestionReservation:
    signal_id: str
    is_new: bool
    requires_extraction: bool
    requires_dispatch: bool


@dataclass(frozen=True)
class IdempotentRequestReservation:
    operation: str
    key: str
    request_hash: str
    is_new: bool
    response_json: str | None = None
    response_status: int | None = None

    @property
    def is_replay(self) -> bool:
        return not self.is_new


class VerificationResultLike(Protocol):
    verification_status: VerificationStatus | None
    evidence: Sequence[Evidence]
    attempt_count: int
    sanitized_failure: str | None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(model: Source | Claim | Evidence | Signal) -> str:
    return model.model_dump_json()


def _safe_error(value: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError("sanitized_error must not be empty")
    if len(cleaned) > 500:
        raise ValueError("sanitized_error must be at most 500 characters")
    return cleaned


def _validate_idempotency_identity(
    operation: str, key: str, request_hash: str
) -> tuple[str, str, str]:
    values = {
        "operation": operation.strip(),
        "key": key.strip(),
        "request_hash": request_hash.strip(),
    }
    if any(not value for value in values.values()):
        raise ValueError("operation, key and request_hash must not be empty")
    if len(values["operation"]) > 100:
        raise ValueError("operation must be at most 100 characters")
    if len(values["key"]) > 255:
        raise ValueError("key must be at most 255 characters")
    if len(values["request_hash"]) > 255:
        raise ValueError("request_hash must be at most 255 characters")
    return values["operation"], values["key"], values["request_hash"]


class SQLiteSignalStore:
    """SQLite repository for A's canonical Signal and Claim resources.

    Every method opens a short-lived connection and completes all writes before
    returning. Callers must perform model/provider work outside these methods.
    """

    def __init__(self, path: str | Path, timeout: float = 5.0) -> None:
        self.path = Path(path)
        self.timeout = timeout

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection: sqlite3.Connection | None = None
        try:
            connection = sqlite3.connect(self.path, timeout=self.timeout)
            connection.row_factory = sqlite3.Row
            connection.execute(f"PRAGMA busy_timeout={int(self.timeout * 1000)}")
            connection.execute("PRAGMA foreign_keys=ON")
            with connection:
                yield connection
        except sqlite3.Error as exc:
            raise SignalStoreUnavailable("SQLite signal store unavailable") from exc
        finally:
            if connection is not None:
                connection.close()

    def init_schema(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS signals (
                    signal_id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    source_json TEXT NOT NULL,
                    source_relation TEXT NOT NULL CHECK (
                        source_relation IN (
                            'original', 'repost', 'independent_report', 'unknown'
                        )
                    ),
                    duplicate_of_signal_id TEXT REFERENCES signals(signal_id),
                    ingestion_status TEXT NOT NULL CHECK (
                        ingestion_status IN ('reserved', 'completed', 'extraction_failed')
                    ),
                    sanitized_error TEXT,
                    created_at TEXT NOT NULL,
                    completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS source_idempotency (
                    provider TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    signal_id TEXT NOT NULL UNIQUE REFERENCES signals(signal_id),
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(provider, source_id)
                );

                CREATE TABLE IF NOT EXISTS claims (
                    claim_id TEXT PRIMARY KEY,
                    signal_id TEXT NOT NULL REFERENCES signals(signal_id),
                    ordinal INTEGER NOT NULL,
                    claim_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(signal_id, ordinal)
                );

                CREATE TABLE IF NOT EXISTS extraction_attempts (
                    extraction_attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    signal_id TEXT NOT NULL REFERENCES signals(signal_id),
                    status TEXT NOT NULL CHECK(status IN ('succeeded', 'failed')),
                    sanitized_failure TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS verification_attempts (
                    verification_attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    claim_id TEXT NOT NULL REFERENCES claims(claim_id),
                    status TEXT NOT NULL CHECK(status IN ('succeeded', 'failed')),
                    verification_status TEXT CHECK (
                        verification_status IS NULL OR verification_status IN (
                            'supported', 'refuted', 'insufficient_evidence',
                            'not_applicable'
                        )
                    ),
                    model_attempt_count INTEGER NOT NULL CHECK (
                        model_attempt_count BETWEEN 0 AND 2
                    ),
                    sanitized_failure TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS evidence (
                    verification_attempt_id INTEGER NOT NULL REFERENCES
                        verification_attempts(verification_attempt_id),
                    evidence_id TEXT NOT NULL,
                    claim_id TEXT NOT NULL REFERENCES claims(claim_id),
                    ordinal INTEGER NOT NULL,
                    evidence_json TEXT NOT NULL,
                    PRIMARY KEY(verification_attempt_id, evidence_id),
                    UNIQUE(verification_attempt_id, ordinal)
                );

                CREATE TABLE IF NOT EXISTS request_idempotency (
                    operation TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    request_hash TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending', 'completed')),
                    response_json TEXT,
                    response_status INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(operation, idempotency_key),
                    CHECK (
                        (status = 'pending' AND response_json IS NULL
                            AND response_status IS NULL)
                        OR
                        (status = 'completed' AND response_json IS NOT NULL
                            AND response_status BETWEEN 100 AND 599)
                    )
                );

                CREATE INDEX IF NOT EXISTS claims_signal
                    ON claims(signal_id, ordinal);
                CREATE INDEX IF NOT EXISTS verification_attempts_claim
                    ON verification_attempts(claim_id, verification_attempt_id DESC);
                CREATE INDEX IF NOT EXISTS evidence_claim
                    ON evidence(claim_id, verification_attempt_id, ordinal);
                """
            )

    def begin_idempotent_request(
        self, operation: str, key: str, request_hash: str
    ) -> IdempotentRequestReservation:
        operation, key, request_hash = _validate_idempotency_identity(
            operation, key, request_hash
        )
        now = _now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                """
                SELECT request_hash, status, response_json, response_status
                FROM request_idempotency
                WHERE operation = ? AND idempotency_key = ?
                """,
                (operation, key),
            ).fetchone()
            if existing is not None:
                if existing["request_hash"] != request_hash:
                    raise IdempotencyKeyConflict(
                        "Idempotency key was already used for a different request"
                    )
                if existing["status"] == "pending":
                    raise IdempotentRequestInProgress(
                        "An identical idempotent request is already in progress"
                    )
                return IdempotentRequestReservation(
                    operation=operation,
                    key=key,
                    request_hash=request_hash,
                    is_new=False,
                    response_json=existing["response_json"],
                    response_status=existing["response_status"],
                )

            connection.execute(
                """
                INSERT INTO request_idempotency(
                    operation, idempotency_key, request_hash, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, 'pending', ?, ?)
                """,
                (operation, key, request_hash, now, now),
            )
            return IdempotentRequestReservation(
                operation=operation,
                key=key,
                request_hash=request_hash,
                is_new=True,
            )

    def complete_idempotent_request(
        self,
        operation: str,
        key: str,
        request_hash: str,
        response_json: str,
        response_status: int,
    ) -> IdempotentRequestReservation:
        operation, key, request_hash = _validate_idempotency_identity(
            operation, key, request_hash
        )
        try:
            json.loads(response_json)
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError("response_json must contain valid JSON") from exc
        if isinstance(response_status, bool) or not 100 <= response_status <= 599:
            raise ValueError("response_status must be an HTTP status from 100 to 599")

        now = _now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT request_hash, status, response_json, response_status
                FROM request_idempotency
                WHERE operation = ? AND idempotency_key = ?
                """,
                (operation, key),
            ).fetchone()
            if row is None:
                raise InvalidIdempotencyState(
                    "Idempotent request has no pending reservation"
                )
            if row["request_hash"] != request_hash:
                raise IdempotencyKeyConflict(
                    "Idempotency key was already used for a different request"
                )
            if row["status"] == "completed":
                return IdempotentRequestReservation(
                    operation=operation,
                    key=key,
                    request_hash=request_hash,
                    is_new=False,
                    response_json=row["response_json"],
                    response_status=row["response_status"],
                )

            changed = connection.execute(
                """
                UPDATE request_idempotency
                SET status = 'completed', response_json = ?, response_status = ?,
                    updated_at = ?
                WHERE operation = ? AND idempotency_key = ?
                    AND request_hash = ? AND status = 'pending'
                """,
                (response_json, response_status, now, operation, key, request_hash),
            ).rowcount
            if changed != 1:
                raise InvalidIdempotencyState(
                    "Idempotent request could not be completed"
                )
            return IdempotentRequestReservation(
                operation=operation,
                key=key,
                request_hash=request_hash,
                is_new=False,
                response_json=response_json,
                response_status=response_status,
            )

    def abort_idempotent_request(
        self, operation: str, key: str, request_hash: str
    ) -> None:
        operation, key, request_hash = _validate_idempotency_identity(
            operation, key, request_hash
        )
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT request_hash, status FROM request_idempotency
                WHERE operation = ? AND idempotency_key = ?
                """,
                (operation, key),
            ).fetchone()
            if row is None:
                return
            if row["request_hash"] != request_hash:
                raise IdempotencyKeyConflict(
                    "Idempotency key was already used for a different request"
                )
            if row["status"] == "completed":
                return
            connection.execute(
                """
                DELETE FROM request_idempotency
                WHERE operation = ? AND idempotency_key = ?
                    AND request_hash = ? AND status = 'pending'
                """,
                (operation, key, request_hash),
            )

    def reserve_source(self, request: SourceReservation) -> IngestionReservation:
        signal_id = f"sig_{uuid4().hex}"
        now = _now()
        with self.connect() as connection:
            # Serialize lookup + insert so concurrent callers cannot both believe
            # they acquired the same provider source.
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                """
                SELECT s.signal_id
                FROM source_idempotency AS i
                JOIN signals AS s ON s.signal_id = i.signal_id
                WHERE i.provider = ? AND i.source_id = ?
                """,
                (request.source.provider, request.source.source_id),
            ).fetchone()
            if existing is not None:
                return IngestionReservation(
                    signal_id=existing["signal_id"],
                    is_new=False,
                    requires_extraction=False,
                    requires_dispatch=False,
                )

            duplicate_of_signal_id: str | None = None
            if request.source_relation == "repost":
                if request.duplicate_of_source_id is None:
                    raise InvalidIngestionState(
                        "A repost must identify its original provider source"
                    )
                target = connection.execute(
                    """
                    SELECT s.signal_id, s.source_relation
                    FROM source_idempotency AS i
                    JOIN signals AS s ON s.signal_id = i.signal_id
                    WHERE i.provider = ? AND i.source_id = ?
                    """,
                    (request.source.provider, request.duplicate_of_source_id),
                ).fetchone()
                if target is None or target["source_relation"] == "repost":
                    raise InvalidIngestionState(
                        "A repost must reference an existing original Signal"
                    )
                duplicate_of_signal_id = target["signal_id"]
            elif request.duplicate_of_source_id is not None:
                raise InvalidIngestionState(
                    "Only a repost may identify an original provider source"
                )

            pure_repost = request.source_relation == "repost"
            status = "completed" if pure_repost else "reserved"
            completed_at = now if pure_repost else None
            connection.execute(
                """
                INSERT INTO signals(
                    signal_id, provider, source_id, source_json, source_relation,
                    duplicate_of_signal_id, ingestion_status, created_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    signal_id,
                    request.source.provider,
                    request.source.source_id,
                    _json(request.source),
                    request.source_relation,
                    duplicate_of_signal_id,
                    status,
                    now,
                    completed_at,
                ),
            )
            connection.execute(
                """
                INSERT INTO source_idempotency(provider, source_id, signal_id, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    request.source.provider,
                    request.source.source_id,
                    signal_id,
                    now,
                ),
            )
            return IngestionReservation(
                signal_id=signal_id,
                is_new=True,
                requires_extraction=not pure_repost,
                requires_dispatch=True,
            )

    def complete_signal(self, signal_id: str, claims: list[Claim]) -> Signal:
        now = _now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT ingestion_status FROM signals WHERE signal_id = ?",
                (signal_id,),
            ).fetchone()
            if row is None:
                raise InvalidIngestionState("Signal reservation does not exist")
            if row["ingestion_status"] == "completed":
                return self._get_signal(connection, signal_id)
            if row["ingestion_status"] != "reserved":
                raise InvalidIngestionState("Signal reservation cannot be completed")
            if any(claim.signal_id != signal_id for claim in claims):
                raise InvalidIngestionState(
                    "Every Claim must retain the reserved Signal ID"
                )
            if len({claim.claim_id for claim in claims}) != len(claims):
                raise InvalidIngestionState("Claim IDs must be unique")

            for ordinal, claim in enumerate(claims):
                connection.execute(
                    """
                    INSERT INTO claims(claim_id, signal_id, ordinal, claim_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (claim.claim_id, signal_id, ordinal, _json(claim), now),
                )
            connection.execute(
                """
                INSERT INTO extraction_attempts(signal_id, status, created_at)
                VALUES (?, 'succeeded', ?)
                """,
                (signal_id, now),
            )
            connection.execute(
                """
                UPDATE signals
                SET ingestion_status = 'completed', sanitized_error = NULL,
                    completed_at = ?
                WHERE signal_id = ?
                """,
                (now, signal_id),
            )
            return self._get_signal(connection, signal_id)

    def fail_extraction(self, signal_id: str, sanitized_error: str) -> None:
        error = _safe_error(sanitized_error)
        now = _now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT ingestion_status FROM signals WHERE signal_id = ?",
                (signal_id,),
            ).fetchone()
            if row is None:
                raise InvalidIngestionState("Signal reservation does not exist")
            if row["ingestion_status"] == "extraction_failed":
                return
            if row["ingestion_status"] != "reserved":
                raise InvalidIngestionState("Signal extraction cannot be failed")
            connection.execute(
                """
                INSERT INTO extraction_attempts(
                    signal_id, status, sanitized_failure, created_at
                ) VALUES (?, 'failed', ?, ?)
                """,
                (signal_id, error, now),
            )
            connection.execute(
                """
                UPDATE signals
                SET ingestion_status = 'extraction_failed', sanitized_error = ?,
                    completed_at = ?
                WHERE signal_id = ?
                """,
                (error, now, signal_id),
            )

    def get_signal(self, signal_id: str) -> Signal | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT signal_id FROM signals WHERE signal_id = ?", (signal_id,)
            ).fetchone()
            return self._get_signal(connection, signal_id) if row else None

    def get_claim(self, claim_id: str) -> Claim | None:
        with self.connect() as connection:
            return self._get_claim(connection, claim_id)

    def append_verification(
        self, claim_id: str, result: VerificationResultLike
    ) -> Claim:
        if result.attempt_count < 0 or result.attempt_count > 2:
            raise ValueError("attempt_count must be between 0 and 2")
        evidence = list(result.evidence)
        if any(item.claim_id != claim_id for item in evidence):
            raise InvalidIngestionState(
                "Every Evidence item must retain the persisted Claim ID"
            )
        if len({item.evidence_id for item in evidence}) != len(evidence):
            raise InvalidIngestionState("Evidence IDs must be unique within an attempt")
        stances = {item.stance for item in evidence}
        if result.verification_status == "supported" and "supports" not in stances:
            raise InvalidIngestionState(
                "A supported verification must cite supporting Evidence"
            )
        if result.verification_status == "refuted" and "refutes" not in stances:
            raise InvalidIngestionState(
                "A refuted verification must cite refuting Evidence"
            )

        failure = (
            _safe_error(result.sanitized_failure)
            if result.sanitized_failure is not None
            else None
        )
        now = _now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = self._get_claim(connection, claim_id)
            if current is None:
                raise InvalidIngestionState("Claim does not exist")

            succeeded = result.verification_status is not None
            if succeeded:
                try:
                    next_claim = current.model_copy(
                        update={
                            "verification_status": result.verification_status,
                            "evidence": evidence,
                        }
                    )
                    next_claim = Claim.model_validate(next_claim.model_dump())
                except ValidationError as exc:
                    raise InvalidIngestionState(
                        "Verification result violates the Claim contract"
                    ) from exc
            else:
                if failure is None:
                    raise InvalidIngestionState(
                        "A failed verification must include a sanitized failure"
                    )
                if evidence:
                    raise InvalidIngestionState(
                        "A failed verification cannot create canonical Evidence"
                    )
                next_claim = current

            cursor = connection.execute(
                """
                INSERT INTO verification_attempts(
                    claim_id, status, verification_status, model_attempt_count,
                    sanitized_failure, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    claim_id,
                    "succeeded" if succeeded else "failed",
                    result.verification_status,
                    result.attempt_count,
                    failure,
                    now,
                ),
            )
            verification_attempt_id = cursor.lastrowid
            for ordinal, item in enumerate(evidence):
                connection.execute(
                    """
                    INSERT INTO evidence(
                        verification_attempt_id, evidence_id, claim_id, ordinal,
                        evidence_json
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        verification_attempt_id,
                        item.evidence_id,
                        claim_id,
                        ordinal,
                        _json(item),
                    ),
                )
            return next_claim

    def _get_signal(
        self, connection: sqlite3.Connection, signal_id: str
    ) -> Signal:
        row = connection.execute(
            "SELECT * FROM signals WHERE signal_id = ?", (signal_id,)
        ).fetchone()
        if row is None:
            raise InvalidIngestionState("Signal does not exist")
        claims = [
            self._get_claim(connection, item["claim_id"])
            for item in connection.execute(
                """
                SELECT claim_id FROM claims
                WHERE signal_id = ? ORDER BY ordinal
                """,
                (signal_id,),
            )
        ]
        return Signal(
            signal_id=signal_id,
            source=Source.model_validate_json(row["source_json"]),
            source_relation=row["source_relation"],
            duplicate_of_signal_id=row["duplicate_of_signal_id"],
            claims=[claim for claim in claims if claim is not None],
        )

    def _get_claim(
        self, connection: sqlite3.Connection, claim_id: str
    ) -> Claim | None:
        row = connection.execute(
            "SELECT claim_json FROM claims WHERE claim_id = ?", (claim_id,)
        ).fetchone()
        if row is None:
            return None
        base = Claim.model_validate_json(row["claim_json"])
        attempt = connection.execute(
            """
            SELECT verification_attempt_id, verification_status
            FROM verification_attempts
            WHERE claim_id = ? AND status = 'succeeded'
            ORDER BY verification_attempt_id DESC LIMIT 1
            """,
            (claim_id,),
        ).fetchone()
        if attempt is None:
            return base
        evidence = [
            Evidence.model_validate_json(item["evidence_json"])
            for item in connection.execute(
                """
                SELECT evidence_json FROM evidence
                WHERE verification_attempt_id = ? ORDER BY ordinal
                """,
                (attempt["verification_attempt_id"],),
            )
        ]
        return Claim.model_validate(
            base.model_copy(
                update={
                    "verification_status": attempt["verification_status"],
                    "evidence": evidence,
                }
            ).model_dump()
        )


# Concise alias for callers that do not need to name the storage engine.
SignalStore = SQLiteSignalStore
