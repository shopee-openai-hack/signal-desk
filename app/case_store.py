from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol
from uuid import uuid4

from .case_schemas import AgentStatus, CaseSnapshot, CaseSummary, Claim, Signal, TimelineItem
from .store import DailyLimitReached, SQLiteRunStore


class VersionConflict(Exception):
    pass


class SignalConflict(Exception):
    pass


class SignalReader(Protocol):
    def get_signal(self, signal_id: str) -> Signal | None: ...
    def get_claim(self, claim_id: str) -> Claim | None: ...


class CaseStore:
    """Case state; A's canonical Signal store can be injected as the read source."""

    def __init__(self, path: str, timeout: int = 5,
                 signal_reader: SignalReader | None = None):
        self.db = SQLiteRunStore(path, timeout)
        self.signal_reader = signal_reader

    def init_schema(self) -> None:
        self.db.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db.connect() as con:
            con.executescript("""
                CREATE TABLE IF NOT EXISTS case_signals (
                    signal_id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cases (
                    case_id TEXT PRIMARY KEY, version INTEGER NOT NULL,
                    snapshot TEXT NOT NULL, updated_at TEXT NOT NULL,
                    status TEXT NOT NULL, next_check_at TEXT);
                CREATE INDEX IF NOT EXISTS cases_due ON cases(status, next_check_at);
                CREATE TABLE IF NOT EXISTS case_revisions (
                    case_id TEXT NOT NULL, version INTEGER NOT NULL,
                    snapshot TEXT NOT NULL, PRIMARY KEY(case_id, version));
                CREATE TABLE IF NOT EXISTS case_timeline (
                    timeline_id TEXT PRIMARY KEY, case_id TEXT NOT NULL,
                    case_version INTEGER NOT NULL, occurred_at TEXT NOT NULL,
                    body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS case_timeline_order
                    ON case_timeline(case_id, occurred_at, timeline_id);
                CREATE TABLE IF NOT EXISTS case_signal_links (
                    signal_id TEXT PRIMARY KEY, case_id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS case_operations (
                    operation_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
                    case_id TEXT NOT NULL, version INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS case_model_calls (
                    call_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS case_model_calls_day ON case_model_calls(created_at);
                CREATE TABLE IF NOT EXISTS case_agent_status (
                    case_id TEXT PRIMARY KEY, body TEXT NOT NULL);
            """)

    def reserve_model_call(self, daily_limit: int) -> None:
        """Count attempts transactionally before awaiting the provider."""
        now = datetime.now(timezone.utc)
        day = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        with self.db.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            count = con.execute("SELECT COUNT(*) FROM case_model_calls WHERE created_at>=?", (day,)).fetchone()[0]
            if count >= daily_limit:
                raise DailyLimitReached()
            con.execute("INSERT INTO case_model_calls(call_id,created_at) VALUES(?,?)",
                        (uuid4().hex, now.isoformat()))

    def save_signal(self, signal: Signal) -> None:
        """Seed a fixture when A's canonical store is not yet connected."""
        if self.signal_reader is not None:
            raise SignalConflict("signals are owned by the injected canonical reader")
        if any(claim.signal_id != signal.signal_id for claim in signal.claims):
            raise SignalConflict("claim signal_id mismatch")
        body = signal.model_dump_json()
        with self.db.connect() as con:
            row = con.execute("SELECT body FROM case_signals WHERE signal_id=?", (signal.signal_id,)).fetchone()
            if row is not None:
                if Signal.model_validate_json(row["body"]) != signal:
                    raise SignalConflict("signal_id already has different content")
                return
            con.execute("INSERT INTO case_signals(signal_id, body) VALUES(?,?)", (signal.signal_id, body))

    def get_signal(self, signal_id: str) -> Signal | None:
        if self.signal_reader is not None:
            return self.signal_reader.get_signal(signal_id)
        with self.db.connect() as con:
            row = con.execute("SELECT body FROM case_signals WHERE signal_id=?", (signal_id,)).fetchone()
            return Signal.model_validate_json(row["body"]) if row else None

    def get_claim(self, claim_id: str) -> Claim | None:
        if self.signal_reader is not None:
            return self.signal_reader.get_claim(claim_id)
        with self.db.connect() as con:
            rows = con.execute("SELECT body FROM case_signals").fetchall()
        for row in rows:
            signal = Signal.model_validate_json(row["body"])
            for claim in signal.claims:
                if claim.claim_id == claim_id:
                    return claim
        return None

    def case_signals(self, case_id: str) -> list[Signal]:
        with self.db.connect() as con:
            ids = [row["signal_id"] for row in con.execute(
                "SELECT signal_id FROM case_signal_links WHERE case_id=? ORDER BY rowid",
                (case_id,),
            )]
        return [signal for signal_id in ids
                if (signal := self.get_signal(signal_id)) is not None]

    def assigned_case(self, signal_id: str) -> CaseSnapshot | None:
        with self.db.connect() as con:
            row = con.execute("SELECT c.snapshot FROM case_signal_links l JOIN cases c ON c.case_id=l.case_id WHERE l.signal_id=?", (signal_id,)).fetchone()
            return CaseSnapshot.model_validate_json(row["snapshot"]) if row else None

    def case_id_for_signal(self, signal_id: str) -> str | None:
        """Read-model join for A's inbox; unassigned Signals remain visible."""
        with self.db.connect() as con:
            row = con.execute(
                "SELECT case_id FROM case_signal_links WHERE signal_id=?",
                (signal_id,),
            ).fetchone()
        return row["case_id"] if row else None

    def get_case(self, case_id: str) -> CaseSnapshot | None:
        with self.db.connect() as con:
            row = con.execute("SELECT snapshot FROM cases WHERE case_id=?", (case_id,)).fetchone()
            return CaseSnapshot.model_validate_json(row["snapshot"]) if row else None

    def list_cases(self, limit: int = 50) -> list[CaseSnapshot]:
        with self.db.connect() as con:
            return [CaseSnapshot.model_validate_json(row["snapshot"]) for row in con.execute(
                "SELECT snapshot FROM cases ORDER BY updated_at DESC, case_id LIMIT ?", (limit,)
            )]

    def list_case_summaries(self, limit: int = 50) -> list[CaseSummary]:
        with self.db.connect() as con:
            rows = con.execute(
                "SELECT c.snapshot, (SELECT t.body FROM case_timeline t "
                "WHERE t.case_id=c.case_id ORDER BY t.occurred_at DESC, "
                "t.rowid DESC LIMIT 1) AS latest_event "
                "FROM cases c ORDER BY COALESCE((SELECT MAX(t.occurred_at) "
                "FROM case_timeline t WHERE t.case_id=c.case_id), "
                "c.updated_at) DESC, c.case_id LIMIT ?",
                (limit,),
            ).fetchall()
        summaries: list[CaseSummary] = []
        for row in rows:
            case = CaseSnapshot.model_validate_json(row["snapshot"])
            event = TimelineItem.model_validate_json(row["latest_event"]) if row["latest_event"] else None
            agent_status = self.get_agent_status(case.case_id)
            summaries.append(CaseSummary(
                case_id=case.case_id, version=case.version, title=case.title,
                status=case.status, business_impact=case.business_impact,
                priority=case.priority, priority_reasons=case.priority_reasons,
                owner=case.owner, latest_change=event.summary if event else None,
                updated_at=max(case.updated_at, event.occurred_at) if event else case.updated_at,
                next_check_at=case.monitoring_plan.next_check_at,
                agent_state=agent_status.state if agent_status else None,
            ))
        return summaries

    def save_agent_status(self, status: AgentStatus) -> None:
        with self.db.connect() as con:
            con.execute(
                "INSERT INTO case_agent_status(case_id,body) VALUES(?,?) "
                "ON CONFLICT(case_id) DO UPDATE SET body=excluded.body",
                (status.case_id, status.model_dump_json()),
            )

    def get_agent_status(self, case_id: str) -> AgentStatus | None:
        with self.db.connect() as con:
            row = con.execute(
                "SELECT body FROM case_agent_status WHERE case_id=?", (case_id,)
            ).fetchone()
        return AgentStatus.model_validate_json(row["body"]) if row else None

    def due_cases(self, now: datetime, limit: int = 20) -> list[CaseSnapshot]:
        """The replay orchestrator may select due cases; it decides when to run."""
        with self.db.connect() as con:
            return [CaseSnapshot.model_validate_json(row["snapshot"]) for row in con.execute(
                "SELECT snapshot FROM cases WHERE status!='closed' AND next_check_at IS NOT NULL AND next_check_at<=? ORDER BY next_check_at,case_id LIMIT ?",
                (now.astimezone(timezone.utc).isoformat(), limit)
            )]

    def timeline(self, case_id: str) -> list[TimelineItem]:
        with self.db.connect() as con:
            return [TimelineItem.model_validate_json(row["body"]) for row in con.execute(
                "SELECT body FROM case_timeline WHERE case_id=? ORDER BY occurred_at, rowid", (case_id,)
            )]

    def operation_result(self, key: str, request_hash: str) -> CaseSnapshot | None:
        with self.db.connect() as con:
            row = con.execute("SELECT o.request_hash,r.snapshot FROM case_operations o JOIN case_revisions r ON r.case_id=o.case_id AND r.version=o.version WHERE o.operation_key=?", (key,)).fetchone()
            if not row:
                return None
            if row["request_hash"] != request_hash:
                raise VersionConflict("Idempotency-Key reused for a different request")
            return CaseSnapshot.model_validate_json(row["snapshot"])

    def save_revision(
        self, snapshot: CaseSnapshot, items: list[TimelineItem], key: str,
        request_hash: str, expected_version: int | None, signal_id: str | None,
    ) -> CaseSnapshot:
        with self.db.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            prior_op = con.execute("SELECT o.request_hash,r.snapshot FROM case_operations o JOIN case_revisions r ON r.case_id=o.case_id AND r.version=o.version WHERE o.operation_key=?", (key,)).fetchone()
            if prior_op:
                if prior_op["request_hash"] != request_hash:
                    raise VersionConflict("Idempotency-Key reused for a different request")
                return CaseSnapshot.model_validate_json(prior_op["snapshot"])
            previous = con.execute("SELECT version FROM cases WHERE case_id=?", (snapshot.case_id,)).fetchone()
            actual_version = previous["version"] if previous else 0
            if actual_version != (expected_version or 0) or snapshot.version != actual_version + 1:
                raise VersionConflict("case version changed")
            if signal_id:
                linked = con.execute("SELECT case_id FROM case_signal_links WHERE signal_id=?", (signal_id,)).fetchone()
                if linked:
                    raise SignalConflict("signal already dispatched")
            body = snapshot.model_dump_json()
            con.execute("INSERT INTO case_revisions(case_id,version,snapshot) VALUES(?,?,?)",
                        (snapshot.case_id, snapshot.version, body))
            con.execute("INSERT INTO cases(case_id,version,snapshot,updated_at,status,next_check_at) VALUES(?,?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,snapshot=excluded.snapshot,updated_at=excluded.updated_at,status=excluded.status,next_check_at=excluded.next_check_at",
                        (snapshot.case_id, snapshot.version, body, snapshot.updated_at.isoformat(),snapshot.status,
                         snapshot.monitoring_plan.next_check_at.astimezone(timezone.utc).isoformat()
                         if snapshot.monitoring_plan.next_check_at else None))
            for item in items:
                con.execute("INSERT INTO case_timeline(timeline_id,case_id,case_version,occurred_at,body) VALUES(?,?,?,?,?)",
                            (item.timeline_id,item.case_id,item.case_version,item.occurred_at.isoformat(),item.model_dump_json()))
            if signal_id:
                con.execute("INSERT INTO case_signal_links(signal_id,case_id) VALUES(?,?)", (signal_id,snapshot.case_id))
            con.execute("INSERT INTO case_operations(operation_key,request_hash,case_id,version) VALUES(?,?,?,?)",
                        (key,request_hash,snapshot.case_id,snapshot.version))
            return snapshot

    def record_repost(
        self, signal_id: str, original_signal_id: str, item: TimelineItem,
        key: str, request_hash: str,
    ) -> CaseSnapshot:
        """Attach a pure repost without creating an assessment revision."""
        with self.db.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            prior = con.execute(
                "SELECT o.request_hash,r.snapshot FROM case_operations o "
                "JOIN case_revisions r ON r.case_id=o.case_id AND r.version=o.version "
                "WHERE o.operation_key=?", (key,),
            ).fetchone()
            if prior:
                if prior["request_hash"] != request_hash:
                    raise VersionConflict("Idempotency-Key reused for a different request")
                return CaseSnapshot.model_validate_json(prior["snapshot"])
            original = con.execute(
                "SELECT c.snapshot FROM case_signal_links l "
                "JOIN cases c ON c.case_id=l.case_id WHERE l.signal_id=?",
                (original_signal_id,),
            ).fetchone()
            if original is None:
                raise SignalConflict("original signal has not been assigned to a case")
            snapshot = CaseSnapshot.model_validate_json(original["snapshot"])
            if item.case_id != snapshot.case_id or item.case_version != snapshot.version:
                raise VersionConflict("case version changed")
            linked = con.execute(
                "SELECT case_id FROM case_signal_links WHERE signal_id=?", (signal_id,)
            ).fetchone()
            if linked:
                if linked["case_id"] != snapshot.case_id:
                    raise SignalConflict("signal already dispatched to another case")
                return snapshot
            con.execute(
                "INSERT INTO case_signal_links(signal_id,case_id) VALUES(?,?)",
                (signal_id, snapshot.case_id),
            )
            con.execute(
                "INSERT INTO case_timeline(timeline_id,case_id,case_version,occurred_at,body) "
                "VALUES(?,?,?,?,?)",
                (item.timeline_id, item.case_id, item.case_version,
                 item.occurred_at.isoformat(), item.model_dump_json()),
            )
            con.execute(
                "INSERT INTO case_operations(operation_key,request_hash,case_id,version) "
                "VALUES(?,?,?,?)",
                (key, request_hash, snapshot.case_id, snapshot.version),
            )
            return snapshot


def new_timeline_item(case_id: str, version: int, kind: str, summary: str, reason: str,
                      refs: list[str], occurred_at: datetime | None = None) -> TimelineItem:
    return TimelineItem(timeline_id=f"tl_{uuid4().hex}", case_id=case_id, case_version=version,
                        kind=kind, occurred_at=occurred_at or datetime.now(timezone.utc),
                        summary=summary, reason=reason, source_refs=refs,
                        actor={"type": "case_agent", "id": f"agent_{case_id}"})
