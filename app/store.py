from __future__ import annotations
import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol
from uuid import UUID, uuid4
from .schemas import PlanResult, RunStatus

class StoreUnavailable(RuntimeError): pass
class DailyLimitReached(RuntimeError): pass

@dataclass
class RunRecord:
    id: UUID
    visitor_id: str
    goal: str
    status: RunStatus
    plan: PlanResult | None
    error: str | None
    created_at: datetime
    completed_at: datetime | None

class RunStoreProtocol(Protocol):
    def init_schema(self) -> None: ...
    def ping(self) -> bool: ...
    def fail_stale_running(self, cutoff: datetime, error: str) -> None: ...
    def create_running(self, visitor_id: str, goal: str, daily_limit: int) -> RunRecord: ...
    def complete(self, run_id: UUID, visitor_id: str, plan: PlanResult) -> RunRecord: ...
    def fail(self, run_id: UUID, visitor_id: str, error: str) -> RunRecord: ...
    def list_for_visitor(self, visitor_id: str, limit: int) -> list[RunRecord]: ...
    def get_for_visitor(self, visitor_id: str, run_id: UUID) -> RunRecord | None: ...

def record(row) -> RunRecord:
    return RunRecord(id=UUID(row['id']), visitor_id=row['visitor_id'], goal=row['goal'], status=row['status'],
        plan=PlanResult.model_validate_json(row['plan']) if row['plan'] else None, error=row['error'],
        created_at=datetime.fromisoformat(row['created_at']),
        completed_at=datetime.fromisoformat(row['completed_at']) if row['completed_at'] else None)

class SQLiteRunStore:
    def __init__(self, path: str, timeout: int = 5):
        self.path = Path(path)
        self.timeout = timeout

    @contextmanager
    def connect(self):
        con = None
        try:
            con = sqlite3.connect(self.path, timeout=self.timeout)
            con.row_factory = sqlite3.Row
            con.execute("PRAGMA busy_timeout=5000")
            con.execute("PRAGMA foreign_keys=ON")
            with con:
                yield con
        except sqlite3.Error as exc:
            raise StoreUnavailable("SQLite unavailable") from exc
        finally:
            if con is not None: con.close()

    def init_schema(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                  id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, goal TEXT NOT NULL,
                  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
                  plan TEXT, error TEXT, created_at TEXT NOT NULL, completed_at TEXT);
                CREATE INDEX IF NOT EXISTS runs_owner ON runs(visitor_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at);
                PRAGMA user_version=1;
            """)

    def ping(self):
        try:
            with self.connect() as con: con.execute("SELECT id FROM runs LIMIT 1")
            return True
        except StoreUnavailable: return False

    def create_running(self, visitor_id, goal, daily_limit):
        now = datetime.now(timezone.utc)
        run_id = str(uuid4())
        with self.connect() as con:
            # Admission and insertion are one short transaction. Never hold it over a model call.
            con.execute("BEGIN IMMEDIATE")
            day = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
            if con.execute("SELECT COUNT(*) FROM runs WHERE created_at>=?", (day,)).fetchone()[0] >= daily_limit:
                raise DailyLimitReached()
            con.execute("INSERT INTO runs(id,visitor_id,goal,status,created_at) VALUES(?,?,?,'running',?)",
                        (run_id,visitor_id,goal,now.isoformat()))
            return record(con.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone())

    def complete(self, run_id, visitor_id, plan):
        return self.update(run_id, visitor_id, 'completed', plan.model_dump_json(), None)

    def fail(self, run_id, visitor_id, error):
        return self.update(run_id, visitor_id, 'failed', None, error)

    def update(self, run_id, visitor_id, state, plan, error):
        with self.connect() as con:
            changed = con.execute("UPDATE runs SET status=?,plan=?,error=?,completed_at=? WHERE id=? AND visitor_id=?",
                (state,plan,error,datetime.now(timezone.utc).isoformat(),str(run_id),visitor_id)).rowcount
            if changed != 1: raise StoreUnavailable("Run unavailable")
            return record(con.execute("SELECT * FROM runs WHERE id=? AND visitor_id=?", (str(run_id),visitor_id)).fetchone())

    def fail_stale_running(self, cutoff, error):
        with self.connect() as con:
            con.execute("UPDATE runs SET status='failed',error=?,completed_at=? WHERE status='running' AND created_at<?",
                        (error,datetime.now(timezone.utc).isoformat(),cutoff.isoformat()))

    def list_for_visitor(self, visitor_id, limit):
        with self.connect() as con:
            return [record(row) for row in con.execute("SELECT * FROM runs WHERE visitor_id=? ORDER BY created_at DESC LIMIT ?",(visitor_id,limit))]

    def get_for_visitor(self, visitor_id, run_id):
        with self.connect() as con:
            row=con.execute("SELECT * FROM runs WHERE visitor_id=? AND id=?",(visitor_id,str(run_id))).fetchone()
            return record(row) if row else None
