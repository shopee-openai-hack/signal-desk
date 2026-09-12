from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


RunStatus = Literal["running", "completed", "failed"]
PlanMode = Literal["demo", "live"]


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
