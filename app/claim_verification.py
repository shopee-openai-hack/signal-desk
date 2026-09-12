from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any, Protocol

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .demo_loader import EvidenceInput
from .schemas import Claim, Evidence, EvidenceStance, VerificationStatus


MAX_VERIFICATION_ATTEMPTS = 2


class VerificationInputError(ValueError):
    """A safe validation failure for caller-supplied verification inputs."""


class EvidenceAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    evidence_id: str = Field(min_length=1)
    stance: EvidenceStance


class VerificationDecision(BaseModel):
    """Structured output expected from a verification provider."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    verification_status: VerificationStatus
    evidence_assessments: tuple[EvidenceAssessment, ...]


class ClaimVerificationResult(BaseModel):
    """Pure service result which the composition layer may persist later."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    verification_status: VerificationStatus | None
    evidence: tuple[Evidence, ...]
    attempt_count: int = Field(ge=0, le=MAX_VERIFICATION_ATTEMPTS)
    sanitized_failure: str | None = None

    @model_validator(mode="after")
    def success_and_failure_fields_must_agree(self) -> ClaimVerificationResult:
        if self.sanitized_failure is None and self.verification_status is None:
            raise ValueError("a successful result requires a verification status")
        if self.sanitized_failure is not None:
            if self.verification_status is not None or self.evidence:
                raise ValueError("a failed result cannot contain a verdict or Evidence")
        return self


class VerificationProvider(Protocol):
    """Injected boundary for one structured verification model call."""

    async def assess(
        self, claim: Claim, evidence: Sequence[EvidenceInput]
    ) -> VerificationDecision | Any: ...


SYSTEM_INSTRUCTIONS = """You verify one claim using only the supplied Evidence.
Do not use outside knowledge and do not infer facts absent from the excerpts.
Return exactly one assessment for every supplied evidence_id and no other IDs.
Use supports when an item directly supports the claim, refutes when it directly
contradicts it, and context_only otherwise. The overall verification_status must be:
- supported only with at least one supports item and no refutes item;
- refuted only with at least one refutes item and no supports item;
- insufficient_evidence for irrelevant, indirect, incomplete, or conflicting items.
Fact and hypothesis claims are externally checkable and cannot be not_applicable.
"""


class OpenAIVerificationProvider:
    """OpenAI Responses API adapter; each ``assess`` performs exactly one call."""

    def __init__(
        self,
        client: AsyncOpenAI,
        model: str,
        *,
        max_output_tokens: int = 800,
    ) -> None:
        self._client = client
        self._model = model
        self._max_output_tokens = max_output_tokens

    async def assess(
        self, claim: Claim, evidence: Sequence[EvidenceInput]
    ) -> VerificationDecision:
        claim_payload = claim.model_dump(
            mode="json",
            include={
                "claim_id",
                "signal_id",
                "kind",
                "quote",
                "normalized_statement",
                "entities",
                "scope",
            },
        )
        evidence_payload = [item.model_dump(mode="json") for item in evidence]
        response = await self._client.responses.parse(
            model=self._model,
            instructions=SYSTEM_INSTRUCTIONS,
            input=json.dumps(
                {"claim": claim_payload, "evidence": evidence_payload},
                ensure_ascii=False,
            ),
            text_format=VerificationDecision,
            max_output_tokens=self._max_output_tokens,
            store=False,
        )
        if response.output_parsed is None:
            raise ValueError("provider returned no structured verification")
        return VerificationDecision.model_validate(response.output_parsed)


class FakeVerificationProvider:
    """Deterministic scripted provider for unit and integration tests."""

    def __init__(
        self,
        responses: Sequence[VerificationDecision | dict[str, Any] | Exception],
    ) -> None:
        self._responses = tuple(responses)
        self.call_count = 0
        self.calls: list[tuple[Claim, tuple[EvidenceInput, ...]]] = []

    async def assess(
        self, claim: Claim, evidence: Sequence[EvidenceInput]
    ) -> VerificationDecision | dict[str, Any]:
        self.calls.append((claim, tuple(evidence)))
        index = self.call_count
        self.call_count += 1
        if index >= len(self._responses):
            raise RuntimeError("fake verification response exhausted")
        response = self._responses[index]
        if isinstance(response, Exception):
            raise response
        return response


class ClaimVerificationService:
    def __init__(
        self,
        provider: VerificationProvider,
        *,
        max_attempts: int = MAX_VERIFICATION_ATTEMPTS,
    ) -> None:
        if max_attempts < 1 or max_attempts > MAX_VERIFICATION_ATTEMPTS:
            raise ValueError("max_attempts must be one or two")
        self._provider = provider
        self._max_attempts = max_attempts

    async def verify(
        self, claim: Claim, evidence: list[EvidenceInput]
    ) -> ClaimVerificationResult:
        _validate_unique_input_evidence(evidence)

        if claim.kind in {"experience", "request"}:
            return _successful_result(
                claim,
                evidence,
                VerificationDecision(
                    verification_status="not_applicable",
                    evidence_assessments=tuple(
                        EvidenceAssessment(
                            evidence_id=item.evidence_id, stance="context_only"
                        )
                        for item in evidence
                    ),
                ),
                attempt_count=0,
            )

        if not evidence:
            return ClaimVerificationResult(
                verification_status="insufficient_evidence",
                evidence=(),
                attempt_count=0,
            )

        for attempt_count in range(1, self._max_attempts + 1):
            try:
                decision = VerificationDecision.model_validate(
                    await self._provider.assess(claim, evidence)
                )
                _validate_decision(claim, evidence, decision)
                return _successful_result(
                    claim, evidence, decision, attempt_count=attempt_count
                )
            except Exception:  # Provider details must not escape the service boundary.
                if attempt_count == self._max_attempts:
                    return ClaimVerificationResult(
                        verification_status=None,
                        evidence=(),
                        attempt_count=attempt_count,
                        sanitized_failure=(
                            f"Verification failed after {attempt_count} attempts."
                        ),
                    )

        raise AssertionError("verification attempt loop must return")


async def verify(
    claim: Claim,
    evidence: list[EvidenceInput],
    *,
    provider: VerificationProvider,
) -> ClaimVerificationResult:
    """Convenience boundary for callers that do not retain a service instance."""

    return await ClaimVerificationService(provider).verify(claim, evidence)


def _validate_unique_input_evidence(evidence: Sequence[EvidenceInput]) -> None:
    evidence_ids = [item.evidence_id for item in evidence]
    if len(evidence_ids) != len(set(evidence_ids)):
        raise VerificationInputError("Evidence IDs must be unique.")


def _validate_decision(
    claim: Claim,
    evidence: Sequence[EvidenceInput],
    decision: VerificationDecision,
) -> None:
    expected_ids = [item.evidence_id for item in evidence]
    actual_ids = [item.evidence_id for item in decision.evidence_assessments]
    if len(actual_ids) != len(set(actual_ids)) or set(actual_ids) != set(expected_ids):
        raise ValueError("provider Evidence IDs do not match the input")

    stances = {item.stance for item in decision.evidence_assessments}
    if decision.verification_status == "supported" and (
        "supports" not in stances or "refutes" in stances
    ):
        raise ValueError("unsupported supported verdict")
    if decision.verification_status == "refuted" and (
        "refutes" not in stances or "supports" in stances
    ):
        raise ValueError("unsupported refuted verdict")
    if "supports" in stances and "refutes" in stances:
        if decision.verification_status != "insufficient_evidence":
            raise ValueError("conflicting Evidence requires insufficient_evidence")
    if claim.kind in {"fact", "hypothesis"} and (
        decision.verification_status == "not_applicable"
    ):
        raise ValueError("checkable claim cannot be not_applicable")


def _successful_result(
    claim: Claim,
    evidence: Sequence[EvidenceInput],
    decision: VerificationDecision,
    *,
    attempt_count: int,
) -> ClaimVerificationResult:
    assessments = {
        item.evidence_id: item.stance for item in decision.evidence_assessments
    }
    canonical_evidence = tuple(
        Evidence(
            evidence_id=item.evidence_id,
            claim_id=claim.claim_id,
            url=item.url,
            title=item.title,
            publisher=item.publisher,
            published_at=item.published_at,
            retrieved_at=item.retrieved_at,
            excerpt=item.excerpt,
            stance=assessments[item.evidence_id],
        )
        for item in evidence
    )
    return ClaimVerificationResult(
        verification_status=decision.verification_status,
        evidence=canonical_evidence,
        attempt_count=attempt_count,
    )
