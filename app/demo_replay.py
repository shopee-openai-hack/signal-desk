"""SQLite-backed, fixture-controlled presentation replay served by FastAPI.

This is a saved demonstration, separate from A/B's live model decisions. Its
responses use the same read contracts as the live Case UI while keeping every
approval and simulated execution in one durable backend state.
"""

from __future__ import annotations

import copy
import json
import sqlite3
from pathlib import Path
from typing import Any
from uuid import uuid4
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field


FIXTURE_PATH = Path(__file__).resolve().parents[1] / "contracts/fixtures/demo/backend_replay.json"
STAGE4_PRODUCTS = {"prod_001", "prod_003", "prod_005"}


class DemoError(Exception):
    def __init__(self, code: str, message: str, status: int, details: dict | None = None):
        self.code, self.message, self.status = code, message, status
        self.details = details or {}
        super().__init__(message)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ResetRequest(StrictModel):
    stage: int = Field(ge=0, le=3)
    confirm: bool = False
    scenario: str = "main"


class AdvanceDemoRequest(StrictModel):
    expected_stage: int = Field(ge=0, le=6)


class ApprovalRequest(StrictModel):
    case_version: int = Field(ge=1)
    product_ids: list[str] = Field(min_length=1)
    approved_by: str = "employee_ops_listing"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _page(items: list[dict]) -> dict:
    return {"items": items, "next_cursor": None}


def _public_case(case: dict) -> dict:
    return {key: value for key, value in case.items() if key != "demo_stage"}


class DemoReplayStore:
    def __init__(self, path: str | Path, timeout: float = 5.0) -> None:
        self.path, self.timeout = Path(path), timeout
        self.fixture: dict[str, Any] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.path, timeout=self.timeout)
        con.row_factory = sqlite3.Row
        con.execute(f"PRAGMA busy_timeout={int(self.timeout * 1000)}")
        return con

    def init_schema(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as con:
            con.execute("CREATE TABLE IF NOT EXISTS demo_replay_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
            con.execute("INSERT OR IGNORE INTO demo_replay_state(id,body) VALUES(1,?)", (json.dumps(self._initial(3)),))

    def _initial(self, stage: int, scenario: str = "main") -> dict:
        saved = copy.deepcopy(self.fixture["stages"][str(stage)])
        if scenario == "failure_retry":
            for product in saved["products"]:
                if product["product_id"] == "prod_007":
                    product["failure_mode"] = "fail_once"
        return {
            "stage": stage, "scenario": scenario, "case": saved["case"],
            "signals": saved["signals"], "products": saved["products"],
            "timeline": saved["timeline"], "agent_status": saved["agent_status"],
            "approvals": [], "executions": [], "idempotency": {},
        }

    def _load(self, con: sqlite3.Connection) -> dict:
        row = con.execute("SELECT body FROM demo_replay_state WHERE id=1").fetchone()
        if row is None:
            raise RuntimeError("Demo replay schema was not initialized")
        return json.loads(row["body"])

    def _save(self, con: sqlite3.Connection, state: dict) -> None:
        con.execute("UPDATE demo_replay_state SET body=? WHERE id=1", (json.dumps(state, ensure_ascii=False),))

    def read(self) -> dict:
        with self._connect() as con:
            return self._load(con)

    def status(self) -> dict:
        state = self.read()
        return {
            "stage": state["stage"], "default_stage": 3,
            "scenario": state["scenario"], "mode": "backend_replay",
            "dataset_id": self.fixture["dataset_id"],
            "provenance": self.fixture["provenance"],
            "approvals": len(state["approvals"]),
            "executions": len(state["executions"]),
        }

    def reset(self, stage: int, confirm: bool, scenario: str) -> dict:
        if stage not in {0, 3} or scenario not in {"main", "failure_retry"}:
            raise DemoError("invalid_reset", "Reset supports Stage 0 or Stage 3 and a known scenario", 422)
        with self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            old = self._load(con)
            if (old["approvals"] or old["executions"]) and not confirm:
                raise DemoError("reset_confirmation_required", "Confirm removal of saved demo actions", 409)
            self._save(con, self._initial(stage, scenario))
        return {"status": "reset", "mode": "backend_replay", "stage": stage,
                "scenario": scenario, "dataset_id": self.fixture["dataset_id"]}

    @staticmethod
    def _replay(state: dict, scope: str, key: str, payload: dict) -> dict | None:
        entry = state["idempotency"].get(f"{scope}:{key}")
        if entry is None:
            return None
        if entry["payload"] != payload:
            raise DemoError("idempotency_key_reused", "Idempotency-Key was reused with another request", 409)
        return entry["response"]

    @staticmethod
    def _record(state: dict, scope: str, key: str, payload: dict, response: dict) -> None:
        state["idempotency"][f"{scope}:{key}"] = {"payload": payload, "response": response}

    def advance(self, expected_stage: int, key: str) -> dict:
        payload = {"expected_stage": expected_stage}
        with self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            state = self._load(con)
            replay = self._replay(state, "advance", key, payload)
            if replay is not None:
                return replay
            stage = state["stage"]
            if stage != expected_stage:
                raise DemoError("stage_conflict", "Replay stage changed; refresh before advancing", 409,
                                {"current_stage": stage})
            if stage >= 6:
                raise DemoError("stage_complete", "The six-stage replay is complete", 409)
            if stage == 4:
                delisted = {item["product_id"] for item in state["products"] if item["status"] == "delisted"}
                if not STAGE4_PRODUCTS.issubset(delisted):
                    raise DemoError("approval_required", "Approve and execute all three confirmed products", 409,
                                    {"missing_product_ids": sorted(STAGE4_PRODUCTS - delisted)})
            previous_version = state["case"]["version"]
            next_stage = stage + 1
            saved = copy.deepcopy(self.fixture["stages"][str(next_stage)])
            state["stage"] = next_stage
            state["case"] = saved["case"]
            state["signals"] = saved["signals"]
            state["agent_status"] = saved["agent_status"]
            prior_products = {item["product_id"]: item for item in state["products"]}
            state["products"] = saved["products"]
            if state["scenario"] == "failure_retry":
                for product in state["products"]:
                    if product["product_id"] == "prod_007":
                        product["failure_mode"] = "fail_once"
            for product in state["products"]:
                prior = prior_products.get(product["product_id"])
                if prior and prior["status"] == "delisted":
                    product["status"] = "delisted"
                    product["version"] = max(product["version"], prior["version"])
            state["timeline"].append(saved["timeline"][-1])
            response = {"case": _public_case(state["case"]), "previous_version": previous_version,
                        "stage": next_stage}
            self._record(state, "advance", key, payload, response)
            self._save(con, state)
            return response

    def list_cases(self) -> dict:
        state = self.read()
        if state["stage"] == 0:
            return _page([])
        case = state["case"]
        latest = state["timeline"][-1] if state["timeline"] else None
        return _page([{
            "case_id": case["case_id"], "version": case["version"],
            "title": case["title"],
            "status": case["status"], "business_impact": case["business_impact"],
            "priority": case["priority"], "priority_reasons": case["priority_reasons"],
            "owner": case["owner"], "latest_change": latest["summary"] if latest else None,
            "updated_at": latest["occurred_at"] if latest else case["updated_at"],
            "next_check_at": case["monitoring_plan"]["next_check_at"],
            "agent_state": state["agent_status"]["state"],
        }])

    def get_case(self, case_id: str) -> dict:
        state = self.read()
        if case_id != self.fixture["case_id"] or state["stage"] == 0:
            raise DemoError("case_not_found", "Case not found", 404)
        return _public_case(state["case"])

    def get_timeline(self, case_id: str) -> dict:
        self.get_case(case_id)
        return _page(self.read()["timeline"])

    def get_agent(self, case_id: str) -> dict:
        self.get_case(case_id)
        return {**self.read()["agent_status"], "source": "backend_replay"}

    def get_signals(self) -> dict:
        return _page([{key: value for key, value in signal.items() if key != "stage"}
                      for signal in self.read()["signals"]])

    def get_products(self) -> dict:
        return _page(self.read()["products"])

    def get_approvals(self, case_id: str) -> dict:
        self.get_case(case_id)
        state = self.read()
        return _page([{**approval, "executions": [item for item in state["executions"]
                                                  if item["approval_id"] == approval["approval_id"]]}
                      for approval in state["approvals"]])

    def list_traces(self) -> dict:
        return _page(copy.deepcopy(self.fixture["trace_summaries"]))

    def get_trace(self, trace_id: str) -> dict:
        trace = self.fixture["traces"].get(trace_id)
        if trace is None:
            raise DemoError("trace_not_found", "Trace not found", 404)
        return copy.deepcopy(trace)

    @staticmethod
    def _event(state: dict, kind: str, summary: str, reason: str, refs: list[str], actor: dict) -> None:
        state["timeline"].append({
            "timeline_id": f"tl_{uuid4().hex}", "case_id": state["case"]["case_id"],
            "case_version": state["case"]["version"], "kind": kind,
            "occurred_at": _now(), "summary": summary, "reason": reason,
            "source_refs": refs, "actor": actor,
        })

    def approve(self, case_id: str, body: ApprovalRequest, key: str) -> dict:
        payload = body.model_dump()
        with self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            state = self._load(con)
            replay = self._replay(state, f"approve:{case_id}", key, payload)
            if replay is not None:
                return replay
            if state["stage"] == 0 or case_id != state["case"]["case_id"]:
                raise DemoError("case_not_found", "Case not found", 404)
            case = state["case"]
            if body.case_version != case["version"]:
                raise DemoError("version_conflict", "Case changed; review before approval", 409,
                                {"current_case_version": case["version"]})
            ids = list(dict.fromkeys(body.product_ids))
            candidates = {item["product_id"]: item for item in case["candidate_products"]}
            products = {item["product_id"]: item for item in state["products"]}
            for product_id in ids:
                candidate, product = candidates.get(product_id), products.get(product_id)
                if (not candidate or candidate["relation"] == "excluded" or not product
                        or not product["is_simulated"] or product["status"] != "active"
                        or (state["stage"] == 4 and
                            (product_id not in STAGE4_PRODUCTS or candidate["relation"] != "confirmed"))):
                    raise DemoError("invalid_selection", f"Product {product_id} is not eligible", 422)
            approval = {"approval_id": f"apr_{uuid4().hex}", "case_id": case_id,
                        "case_version": case["version"], "product_ids": ids,
                        "status": "approved", "approved_by": body.approved_by,
                        "approved_at": _now()}
            state["approvals"].append(approval)
            self._event(state, "approval_recorded", "Employee approved selected simulated products",
                        "Approval alone does not change a listing", [approval["approval_id"]],
                        {"type": "employee", "id": body.approved_by})
            response = {"approval": copy.deepcopy(approval), "case": _public_case(case)}
            self._record(state, f"approve:{case_id}", key, payload, response)
            self._save(con, state)
            return response

    def execute(self, approval_id: str, key: str) -> dict:
        with self._connect() as con:
            con.execute("BEGIN IMMEDIATE")
            state = self._load(con)
            replay = self._replay(state, f"execute:{approval_id}", key, {})
            if replay is not None:
                return replay
            approval = next((item for item in state["approvals"] if item["approval_id"] == approval_id), None)
            if approval is None:
                raise DemoError("approval_not_found", "Approval not found", 404)
            case = state["case"]
            if approval["case_version"] != case["version"]:
                raise DemoError("version_conflict", "Approval is stale", 409,
                                {"current_case_version": case["version"]})
            results, succeeded, failed = [], 0, 0
            for product_id in approval["product_ids"]:
                product = next(item for item in state["products"] if item["product_id"] == product_id)
                execution = next((item for item in state["executions"] if item["approval_id"] == approval_id
                                  and item["product_id"] == product_id), None)
                if execution is None:
                    execution = {"execution_id": f"exec_{uuid4().hex}", "approval_id": approval_id,
                                 "product_id": product_id, "status": "pending", "error": None,
                                 "executed_at": None, "attempts": 0}
                    state["executions"].append(execution)
                if execution["status"] == "succeeded":
                    succeeded += 1
                    results.append(copy.deepcopy(execution))
                    continue
                execution["attempts"] += 1
                execution["executed_at"] = _now()
                if product.get("failure_mode") == "fail_once" and execution["attempts"] == 1:
                    execution["status"] = "failed"
                    execution["error"] = "Simulated platform temporarily rejected the action"
                    failed += 1
                else:
                    execution["status"] = "succeeded"
                    execution["error"] = None
                    if product["status"] == "active":
                        product["status"] = "delisted"
                        product["version"] += 1
                    succeeded += 1
                self._event(state, "action_executed", f"{product['name']}: {execution['status']}",
                            execution["error"] or "Employee approval and Case version were valid",
                            [execution["execution_id"]], {"type": "simulation", "id": "demo_platform"})
                results.append(copy.deepcopy(execution))
            if succeeded:
                case["status"] = "actioned"
            if state["stage"] == 4 and STAGE4_PRODUCTS.issubset(
                {item["product_id"] for item in state["products"] if item["status"] == "delisted"}
            ):
                state["agent_status"].update({
                    "state": "waiting_follow_up",
                    "current_step": "已執行三筆 confirmed 商品的模擬下架",
                    "latest_result": "Stage 4 已完成核可與逐項執行",
                    "waiting_reason": None,
                    "next_action": "注入 Stage 5 證據",
                    "observed_at": _now(),
                })
            response = {"approval": copy.deepcopy(approval), "executions": results,
                        "case": _public_case(case),
                        "summary": {"succeeded": succeeded, "failed": failed, "total": len(results)}}
            self._record(state, f"execute:{approval_id}", key, {}, response)
            self._save(con, state)
            return response
