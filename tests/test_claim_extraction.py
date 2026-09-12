from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.claim_extraction import (
    MAX_CLAIMS_PER_SOURCE,
    ClaimExtractionError,
    ClaimExtractor,
    OpenAIClaimDraftProvider,
)
from app.schemas import Source


class FakeProvider:
    def __init__(self, *responses: object) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[Source, bool]] = []

    async def generate(self, source: Source, *, correction: bool) -> object:
        self.calls.append((source, correction))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class SequentialIds:
    def __init__(self) -> None:
        self.next_value = 1

    def __call__(self) -> str:
        value = f"clm_test_{self.next_value}"
        self.next_value += 1
        return value


def source(raw_text: str) -> Source:
    return Source(
        provider="synthesized",
        source_id="post_test",
        url="https://example.test/post/test",
        author_ref="user_test",
        published_at=datetime(2026, 9, 12, 1, 55, tzinfo=timezone.utc),
        retrieved_at=datetime(2026, 9, 12, 2, 0, tzinfo=timezone.utc),
        raw_text=raw_text,
        retrieval_status="retrieved",
    )


def draft(
    *,
    kind: str,
    quote: str,
    normalized_statement: str | None = None,
    entities: list[dict[str, str]] | None = None,
    region: str | None = None,
    batch: str | None = None,
    time_window: str | None = None,
) -> dict[str, object]:
    return {
        "kind": kind,
        "quote": quote,
        "normalized_statement": normalized_statement or quote,
        "entities": entities or [],
        "scope": {
            "region": region,
            "batch": batch,
            "time_window": time_window,
        },
    }


def run_extract(
    provider: FakeProvider,
    source_value: Source,
) -> list:
    extractor = ClaimExtractor(provider, claim_id_factory=SequentialIds())
    return asyncio.run(extractor.extract("sig_test", source_value))


def test_experience_only_post_yields_one_canonical_experience_claim() -> None:
    text = "我買的 Demo 牌食用油有怪味。"
    provider = FakeProvider(
        {
            "claims": [
                draft(
                    kind="experience",
                    quote=text,
                    normalized_statement="作者表示買到的 Demo 牌食用油有怪味",
                    entities=[{"type": "brand", "name": "Demo"}],
                )
            ]
        }
    )

    claims = run_extract(provider, source(text))

    assert len(claims) == 1
    assert claims[0].model_dump(mode="json") == {
        "claim_id": "clm_test_1",
        "signal_id": "sig_test",
        "kind": "experience",
        "quote": text,
        "normalized_statement": "作者表示買到的 Demo 牌食用油有怪味",
        "entities": [{"type": "brand", "name": "Demo"}],
        "scope": {"region": None, "batch": None, "time_window": None},
        "verification_status": "not_applicable",
        "evidence": [],
    }
    assert provider.calls == [(source(text), False)]


def test_compound_same_scope_statement_is_preserved_as_one_claim() -> None:
    text = "Demo 牌 B123 批次食用油有異味且顏色異常。"
    provider = FakeProvider(
        {
            "claims": [
                draft(
                    kind="experience",
                    quote=text,
                    entities=[{"type": "brand", "name": "Demo"}],
                    batch="B123",
                )
            ]
        }
    )

    claims = run_extract(provider, source(text))

    assert [claim.quote for claim in claims] == [text]
    assert claims[0].scope.batch == "B123"


def test_mixed_post_preserves_kind_scope_and_verification_path_boundaries() -> None:
    text = "我買的 Demo 油有怪味。有人說 B123 批次檢驗不合格，請平台調查。"
    provider = FakeProvider(
        {
            "claims": [
                draft(kind="experience", quote="我買的 Demo 油有怪味。"),
                draft(
                    kind="hypothesis",
                    quote="有人說 B123 批次檢驗不合格",
                    batch="B123",
                ),
                draft(kind="request", quote="請平台調查"),
            ]
        }
    )

    claims = run_extract(provider, source(text))

    assert [claim.kind for claim in claims] == [
        "experience",
        "hypothesis",
        "request",
    ]
    assert [claim.verification_status for claim in claims] == [
        "not_applicable",
        "insufficient_evidence",
        "not_applicable",
    ]
    assert [claim.claim_id for claim in claims] == [
        "clm_test_1",
        "clm_test_2",
        "clm_test_3",
    ]


@pytest.mark.parametrize(
    ("invalid_claim", "error_kind"),
    [
        (
            draft(kind="fact", quote="來源中沒有的文字"),
            "invalid quote",
        ),
        (
            draft(
                kind="fact",
                quote="這批食用油有問題",
                entities=[{"type": "brand", "name": "Invented Brand"}],
            ),
            "invented entity",
        ),
        (
            draft(
                kind="fact",
                quote="這批食用油有問題",
                region="台北",
            ),
            "invented scope",
        ),
    ],
)
def test_invalid_grounding_is_retried_then_corrected(
    invalid_claim: dict[str, object],
    error_kind: str,
) -> None:
    del error_kind
    text = "這批食用油有問題"
    provider = FakeProvider(
        {"claims": [invalid_claim]},
        {"claims": [draft(kind="fact", quote=text)]},
    )

    claims = run_extract(provider, source(text))

    assert claims[0].quote == text
    assert [correction for _, correction in provider.calls] == [False, True]


def test_malformed_structured_output_is_retried() -> None:
    text = "Demo 油可能有問題"
    provider = FakeProvider(
        "not-json",
        {"claims": [draft(kind="hypothesis", quote=text)]},
    )

    claims = run_extract(provider, source(text))

    assert claims[0].verification_status == "insufficient_evidence"
    assert [correction for _, correction in provider.calls] == [False, True]


def test_more_than_six_claims_exhausts_bounded_retry() -> None:
    text = "a"
    response = {
        "claims": [draft(kind="fact", quote=text) for _ in range(MAX_CLAIMS_PER_SOURCE + 1)]
    }
    provider = FakeProvider(response, response)

    with pytest.raises(ClaimExtractionError, match="after two attempts"):
        run_extract(provider, source(text))

    assert len(provider.calls) == 2


def test_provider_failures_are_bounded_and_sanitized() -> None:
    provider = FakeProvider(RuntimeError("secret response"), RuntimeError("still secret"))

    with pytest.raises(ClaimExtractionError) as caught:
        run_extract(provider, source("Demo"))

    assert len(provider.calls) == 2
    assert "secret" not in str(caught.value)


def test_empty_content_can_return_no_claims() -> None:
    provider = FakeProvider({"claims": []})

    assert run_extract(provider, source("...")) == []


def test_openai_provider_uses_configured_model_and_strict_schema() -> None:
    calls: list[dict[str, object]] = []

    class FakeCompletions:
        async def create(self, **kwargs: object) -> object:
            calls.append(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content='{"claims":[]}'))]
            )

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=FakeCompletions())
    )
    settings = SimpleNamespace(
        openai_api_key=None,
        openai_model="configured-test-model",
        model_timeout_seconds=5.0,
    )
    provider = OpenAIClaimDraftProvider(settings, client=fake_client)  # type: ignore[arg-type]

    result = asyncio.run(provider.generate(source("Demo"), correction=False))

    assert result == '{"claims":[]}'
    assert calls[0]["model"] == "configured-test-model"
    assert calls[0]["max_completion_tokens"] == 1200
    response_format = calls[0]["response_format"]
    assert isinstance(response_format, dict)
    assert response_format["type"] == "json_schema"
    assert response_format["json_schema"]["strict"] is True
    assert "tools" not in calls[0]
