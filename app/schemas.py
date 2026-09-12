from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


RunStatus = Literal["running", "completed", "failed"]
PlanMode = Literal["demo", "live"]
SignalKind = Literal["fact", "experience", "hypothesis", "request"]
SourceRelation = Literal["original", "repost", "independent_report", "unknown"]
VerificationStatus = Literal[
    "supported", "refuted", "insufficient_evidence", "not_applicable"
]
EvidenceStance = Literal["supports", "refutes", "context_only"]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamp must include a UTC timezone")
    if value.utcoffset() != timedelta(0):
        raise ValueError("timestamp must be UTC")
    return value.astimezone(timezone.utc)


class ContractModel(BaseModel):
    """Strict base for shared cross-workstream resource models."""

    model_config = ConfigDict(extra="forbid")


class Source(ContractModel):
    provider: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    author_ref: str | None
    published_at: datetime
    retrieved_at: datetime
    raw_text: str
    retrieval_status: str = Field(min_length=1)

    @field_validator("published_at", "retrieved_at")
    @classmethod
    def timestamps_must_be_utc(cls, value: datetime) -> datetime:
        return _as_utc(value)


class Entity(ContractModel):
    type: str = Field(min_length=1)
    name: str = Field(min_length=1)


class ClaimScope(ContractModel):
    region: str | None
    batch: str | None
    time_window: str | None


class Evidence(ContractModel):
    evidence_id: str = Field(min_length=1)
    claim_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    title: str = Field(min_length=1)
    publisher: str = Field(min_length=1)
    published_at: datetime
    retrieved_at: datetime
    excerpt: str = Field(min_length=1)
    stance: EvidenceStance

    @field_validator("published_at", "retrieved_at")
    @classmethod
    def timestamps_must_be_utc(cls, value: datetime) -> datetime:
        return _as_utc(value)


class Claim(ContractModel):
    claim_id: str = Field(min_length=1)
    signal_id: str = Field(min_length=1)
    kind: SignalKind
    quote: str = Field(min_length=1)
    normalized_statement: str = Field(min_length=1)
    entities: list[Entity]
    scope: ClaimScope
    verification_status: VerificationStatus
    evidence: list[Evidence]

    @model_validator(mode="after")
    def validate_evidence_links(self) -> Claim:
        if any(item.claim_id != self.claim_id for item in self.evidence):
            raise ValueError("every Evidence item must reference its parent Claim")
        if self.verification_status in {"supported", "refuted"} and not self.evidence:
            raise ValueError("supported and refuted Claims must cite Evidence")
        return self


class Signal(ContractModel):
    signal_id: str = Field(min_length=1)
    source: Source
    source_relation: SourceRelation
    duplicate_of_signal_id: str | None
    claims: list[Claim]

    @model_validator(mode="after")
    def validate_claim_links(self) -> Signal:
        if any(item.signal_id != self.signal_id for item in self.claims):
            raise ValueError("every Claim must reference its parent Signal")
        return self


class GoalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal: str = Field(min_length=3, max_length=2000)

    @field_validator("goal")
    @classmethod
    def clean_goal(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 3:
            raise ValueError("請輸入至少 3 個字的目標")
        return cleaned


class PlanStep(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    action: str = Field(min_length=1, max_length=500)
    why: str = Field(min_length=1, max_length=300)
    done_when: str = Field(min_length=1, max_length=300)
    minutes: int = Field(ge=5, le=180)


class PlanDraft(BaseModel):
    summary: str = Field(min_length=1, max_length=500)
    first_step: str = Field(min_length=1, max_length=300)
    steps: list[PlanStep] = Field(min_length=3, max_length=3)


class PlanResult(PlanDraft):
    mode: PlanMode


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    goal: str
    status: RunStatus
    mode: PlanMode | None = None
    plan: PlanResult | None = None
    error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


class ConfigResponse(BaseModel):
    mode: PlanMode
    max_goal_chars: int
    rate_limit_per_minute: int


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
    mode: PlanMode
