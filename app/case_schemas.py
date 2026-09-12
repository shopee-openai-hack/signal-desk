from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .schemas import Claim, Evidence, Signal


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MonitoringPlan(StrictModel):
    targets: list[str] = Field(default_factory=list)
    next_check_at: datetime | None = None
    reason: str


class CandidateProduct(StrictModel):
    product_id: str
    relation: Literal["candidate", "confirmed", "excluded"]
    reason: str
    missing_information: list[str] = Field(default_factory=list)


class CaseOwner(StrictModel):
    type: Literal["case_agent"] = "case_agent"
    id: str


class CaseSnapshot(StrictModel):
    case_id: str
    version: int = Field(ge=1)
    title: str
    status: Literal["monitoring", "investigating", "awaiting_approval", "actioned", "closed"]
    business_impact: Literal["opportunity", "risk", "bidirectional", "no_material_impact", "pending"]
    priority: Literal["low", "medium", "high", "critical"]
    priority_reasons: list[str]
    owner: CaseOwner
    claim_ids: list[str]
    unknowns: list[str]
    next_steps: list[str]
    monitoring_plan: MonitoringPlan
    candidate_products: list[CandidateProduct]
    updated_at: datetime


class CaseSummary(StrictModel):
    case_id: str
    version: int = Field(ge=1)
    title: str
    status: Literal["monitoring", "investigating", "awaiting_approval", "actioned", "closed"]
    business_impact: Literal["opportunity", "risk", "bidirectional", "no_material_impact", "pending"]
    priority: Literal["low", "medium", "high", "critical"]
    priority_reasons: list[str]
    owner: CaseOwner
    latest_change: str | None = None
    updated_at: datetime
    next_check_at: datetime | None = None
    agent_state: Literal["waiting", "running", "waiting_human", "waiting_follow_up", "failed"] | None = None


class AgentStatus(StrictModel):
    case_id: str
    agent_id: str
    state: Literal["waiting", "running", "waiting_human", "waiting_follow_up", "failed"]
    current_step: str
    latest_result: str
    waiting_reason: str | None = None
    next_action: str | None = None
    observed_at: datetime
    source: Literal["backend", "backend_replay"] = "backend"


class SignalRead(Signal):
    case_id: str | None


class SignalPage(StrictModel):
    items: list[SignalRead]
    next_cursor: str | None = None


class TimelineItem(StrictModel):
    timeline_id: str
    case_id: str
    case_version: int
    kind: Literal["signal_added", "verification_updated", "assessment_updated", "monitoring_updated", "approval_recorded", "action_executed"]
    occurred_at: datetime
    summary: str
    reason: str
    source_refs: list[str]
    actor: CaseOwner


class CaseDecision(StrictModel):
    """The model proposes a decision; the service validates IDs and owns state changes."""

    case_id: str | None = None
    title: str
    status: Literal["monitoring", "investigating", "awaiting_approval", "actioned", "closed"]
    business_impact: Literal["opportunity", "risk", "bidirectional", "no_material_impact", "pending"]
    priority: Literal["low", "medium", "high", "critical"]
    priority_reasons: list[str]
    unknowns: list[str]
    next_steps: list[str]
    monitoring_plan: MonitoringPlan
    candidate_products: list[CandidateProduct]
    summary: str
    reason: str
    source_refs: list[str]


class DispatchRequest(StrictModel):
    signal_id: str
    replay_at: datetime | None = None


class VerificationUpdate(StrictModel):
    claim_id: str
    verification_status: Literal["supported", "refuted", "insufficient_evidence", "not_applicable"]
    evidence: list[Evidence] = Field(default_factory=list)


class AdvanceRequest(StrictModel):
    expected_version: int = Field(ge=1)
    verification_updates: list[VerificationUpdate] = Field(default_factory=list)
    replay_at: datetime | None = None


class Page(StrictModel):
    items: list[CaseSummary]
    next_cursor: str | None = None


class TimelinePage(StrictModel):
    items: list[TimelineItem]
    next_cursor: str | None = None
