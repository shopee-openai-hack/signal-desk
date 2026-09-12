from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from app.claim_verification import (
    ClaimVerificationService,
    FakeVerificationProvider,
    OpenAIVerificationProvider,
    VerificationInputError,
)
from app.demo_loader import EvidenceInput
from app.schemas import Claim, ClaimScope, Entity, Evidence


def _claim(kind: str = "fact", *, with_old_evidence: bool = False) -> Claim:
    old_evidence = (
        [
            Evidence(
                evidence_id="ev_old_not_supplied",
                claim_id="clm_001",
                url="https://example.test/old",
                title="Old fictional evidence",
                publisher="Fictional publisher",
                published_at=datetime(2026, 9, 12, 0, 0, tzinfo=timezone.utc),
                retrieved_at=datetime(2026, 9, 12, 0, 1, tzinfo=timezone.utc),
                excerpt="Old content which must not be sent.",
                stance="context_only",
            )
        ]
        if with_old_evidence
        else []
    )
    return Claim(
        claim_id="clm_001",
        signal_id="sig_001",
        kind=kind,
        quote="Demo 牌 B123 批次食用油不合格",
        normalized_statement="Demo 牌 B123 批次食用油不合格",
        entities=[Entity(type="brand", name="Demo")],
        scope=ClaimScope(region=None, batch="B123", time_window=None),
        verification_status=(
            "not_applicable"
            if kind in {"experience", "request"}
            else "insufficient_evidence"
        ),
        evidence=old_evidence,
    )


def _evidence(evidence_id: str, excerpt: str = "Synthesized result") -> EvidenceInput:
    return EvidenceInput(
        stage=4,
        evidence_id=evidence_id,
        url=f"https://example.test/{evidence_id}",
        title="Fictional evidence",
        publisher="Synthesized authority (fictional)",
        published_at="2026-09-12T03:00:00Z",
        retrieved_at="2026-09-12T03:01:00Z",
        excerpt=excerpt,
    )


def _verify(
    service: ClaimVerificationService,
    claim: Claim,
    evidence: list[EvidenceInput],
):
    return asyncio.run(service.verify(claim, evidence))


@pytest.mark.parametrize(
    ("status", "stance"),
    [("supported", "supports"), ("refuted", "refutes")],
)
def test_supported_and_refuted_results_are_canonical_and_linked(
    status: str, stance: str
) -> None:
    provider = FakeVerificationProvider(
        [
            {
                "verification_status": status,
                "evidence_assessments": [
                    {"evidence_id": "ev_001", "stance": stance}
                ],
            }
        ]
    )

    result = _verify(
        ClaimVerificationService(provider),
        _claim(), [_evidence("ev_001")]
    )

    assert result.verification_status == status
    assert result.attempt_count == 1
    assert result.sanitized_failure is None
    assert len(result.evidence) == 1
    assert result.evidence[0].claim_id == "clm_001"
    assert result.evidence[0].stance == stance


def test_irrelevant_evidence_is_insufficient() -> None:
    provider = FakeVerificationProvider(
        [
            {
                "verification_status": "insufficient_evidence",
                "evidence_assessments": [
                    {"evidence_id": "ev_001", "stance": "context_only"}
                ],
            }
        ]
    )

    result = _verify(
        ClaimVerificationService(provider),
        _claim(), [_evidence("ev_001", "Unrelated fictional product")]
    )

    assert result.verification_status == "insufficient_evidence"
    assert result.evidence[0].stance == "context_only"


def test_absent_evidence_is_insufficient_without_a_provider_call() -> None:
    provider = FakeVerificationProvider([])

    result = _verify(ClaimVerificationService(provider), _claim(), [])

    assert result.verification_status == "insufficient_evidence"
    assert result.evidence == ()
    assert result.attempt_count == 0
    assert provider.call_count == 0


def test_conflicting_evidence_is_preserved_as_insufficient() -> None:
    provider = FakeVerificationProvider(
        [
            {
                "verification_status": "insufficient_evidence",
                "evidence_assessments": [
                    {"evidence_id": "ev_support", "stance": "supports"},
                    {"evidence_id": "ev_refute", "stance": "refutes"},
                ],
            }
        ]
    )

    result = _verify(
        ClaimVerificationService(provider),
        _claim(), [_evidence("ev_support"), _evidence("ev_refute")]
    )

    assert result.verification_status == "insufficient_evidence"
    assert [item.stance for item in result.evidence] == ["supports", "refutes"]


@pytest.mark.parametrize("kind", ["experience", "request"])
def test_non_checkable_claim_is_not_applicable_without_provider_call(kind: str) -> None:
    provider = FakeVerificationProvider([])

    result = _verify(
        ClaimVerificationService(provider),
        _claim(kind), [_evidence("ev_001")]
    )

    assert result.verification_status == "not_applicable"
    assert result.evidence[0].stance == "context_only"
    assert result.attempt_count == 0
    assert provider.call_count == 0


def test_provider_cannot_cite_an_evidence_id_absent_from_input() -> None:
    provider = FakeVerificationProvider(
        [
            {
                "verification_status": "supported",
                "evidence_assessments": [
                    {"evidence_id": "ev_not_supplied", "stance": "supports"}
                ],
            },
            {
                "verification_status": "supported",
                "evidence_assessments": [
                    {"evidence_id": "ev_still_not_supplied", "stance": "supports"}
                ],
            },
        ]
    )

    result = _verify(
        ClaimVerificationService(provider),
        _claim(), [_evidence("ev_supplied")]
    )

    assert result.verification_status is None
    assert result.evidence == ()
    assert result.attempt_count == 2
    assert result.sanitized_failure == "Verification failed after 2 attempts."
    assert "ev_not_supplied" not in result.sanitized_failure


@pytest.mark.parametrize(
    ("status", "stance"),
    [("supported", "context_only"), ("refuted", "context_only")],
)
def test_strong_verdict_without_corresponding_stance_is_retried_then_fails(
    status: str, stance: str
) -> None:
    invalid = {
        "verification_status": status,
        "evidence_assessments": [{"evidence_id": "ev_001", "stance": stance}],
    }
    provider = FakeVerificationProvider([invalid, invalid])

    result = _verify(
        ClaimVerificationService(provider),
        _claim(), [_evidence("ev_001")]
    )

    assert result.verification_status is None
    assert result.attempt_count == 2
    assert provider.call_count == 2


def test_provider_failure_retries_once_and_does_not_leak_details() -> None:
    provider = FakeVerificationProvider(
        [RuntimeError("secret provider response"), RuntimeError("private API detail")]
    )

    result = _verify(
        ClaimVerificationService(provider),
        _claim(), [_evidence("ev_001")]
    )

    assert result.verification_status is None
    assert result.evidence == ()
    assert result.attempt_count == 2
    assert result.sanitized_failure == "Verification failed after 2 attempts."
    assert "secret" not in result.sanitized_failure
    assert "private" not in result.sanitized_failure


def test_duplicate_input_evidence_is_rejected_before_provider_call() -> None:
    provider = FakeVerificationProvider([])
    duplicate = _evidence("ev_001")

    with pytest.raises(VerificationInputError):
        _verify(
            ClaimVerificationService(provider),
            _claim(),
            [duplicate, duplicate],
        )

    assert provider.call_count == 0


def test_invalid_first_response_can_succeed_on_second_attempt() -> None:
    provider = FakeVerificationProvider(
        [
            {"not": "the schema"},
            {
                "verification_status": "supported",
                "evidence_assessments": [
                    {"evidence_id": "ev_001", "stance": "supports"}
                ],
            },
        ]
    )

    result = _verify(
        ClaimVerificationService(provider),
        _claim(), [_evidence("ev_001")]
    )

    assert result.verification_status == "supported"
    assert result.attempt_count == 2
    assert provider.call_count == 2


class _RecordingResponses:
    def __init__(self) -> None:
        self.kwargs: dict[str, Any] | None = None

    async def parse(self, **kwargs: Any) -> SimpleNamespace:
        self.kwargs = kwargs
        return SimpleNamespace(
            output_parsed={
                "verification_status": "supported",
                "evidence_assessments": [
                    {"evidence_id": "ev_supplied", "stance": "supports"}
                ],
            }
        )


def test_openai_adapter_sends_only_supplied_evidence_in_one_structured_call() -> None:
    responses = _RecordingResponses()
    client = SimpleNamespace(responses=responses)
    provider = OpenAIVerificationProvider(client, "test-model")  # type: ignore[arg-type]

    decision = asyncio.run(
        provider.assess(
            _claim(with_old_evidence=True), [_evidence("ev_supplied")]
        )
    )

    assert decision.verification_status == "supported"
    assert responses.kwargs is not None
    payload = json.loads(responses.kwargs["input"])
    assert "evidence" not in payload["claim"]
    assert [item["evidence_id"] for item in payload["evidence"]] == ["ev_supplied"]
    assert "ev_old_not_supplied" not in responses.kwargs["input"]
    assert responses.kwargs["text_format"].__name__ == "VerificationDecision"
