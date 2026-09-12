from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from typing import Any, Protocol
from uuid import uuid4

import httpx
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .config import Settings
from .schemas import Claim, ClaimScope, Entity, SignalKind, Source

logger = logging.getLogger(__name__)

MAX_CLAIMS_PER_SOURCE = 6
MAX_MODEL_ATTEMPTS = 2
MAX_COMPLETION_TOKENS = 1200


class ClaimExtractionError(RuntimeError):
    """A bounded extraction failure safe to persist or return at an API boundary."""


class ClaimGroundingError(ValueError):
    """The structured response contains content not grounded in its quoted text."""


class ClaimDraft(BaseModel):
    """Provider output before application-owned IDs and verification state exist."""

    model_config = ConfigDict(extra="forbid")

    kind: SignalKind
    quote: str = Field(min_length=1)
    normalized_statement: str = Field(min_length=1)
    entities: list[Entity]
    scope: ClaimScope


class ClaimDraftResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claims: list[ClaimDraft] = Field(max_length=MAX_CLAIMS_PER_SOURCE)


class ClaimDraftProviderProtocol(Protocol):
    async def generate(self, source: Source, *, correction: bool) -> object:
        """Return one structured extraction response for the supplied source."""


class ClaimExtractorProtocol(Protocol):
    async def extract(self, signal_id: str, source: Source) -> list[Claim]:
        """Return canonical Claims linked to one reserved Signal ID."""


SYSTEM_PROMPT = """You extract source-grounded claim units from one market-signal source.
Return only JSON matching the supplied schema. Never use outside knowledge.

Rules:
- A claim is the smallest independently verifiable or actionable statement, not each grammatical field.
- A typical post has 0-2 claims; never return more than 6.
- Split only when kind, verification source/path, brand/batch/region/time scope, or possible verdict differs.
- Keep a brand, batch, publisher, and modifiers together when they describe one proposition.
- kind is fact, experience, hypothesis, or request. Fact means asserted as fact, not proven true.
- quote must be a non-empty exact contiguous substring of source.raw_text.
- normalized_statement may clarify the quote but must add no entity, scope, cause, responsibility, or outcome.
- Every entity name and every non-null scope value must appear in quote. Unknown scope values are null.
- Use only the current source. Do not infer facts or scope from another source.
- Empty or non-substantive content may return an empty claims list.
- A checkable proposition embedded in an experience is separate only when it needs a different verification path.
- Do not return runtime IDs, Evidence, or verification status.
"""


class OpenAIClaimDraftProvider:
    """OpenAI structured-output adapter configured entirely by backend settings."""

    def __init__(self, settings: Settings, *, client: Any | None = None) -> None:
        if client is None and not settings.openai_api_key:
            raise ClaimExtractionError(
                "Claim extraction requires an OpenAI key or an injected provider."
            )

        self.model = settings.openai_model
        self._owns_client = client is None
        self._client = client or AsyncOpenAI(
            api_key=settings.openai_api_key,
            timeout=settings.model_timeout_seconds,
            max_retries=0,
            http_client=httpx.AsyncClient(timeout=settings.model_timeout_seconds),
        )

    async def close(self) -> None:
        if self._owns_client:
            await self._client.close()

    async def generate(self, source: Source, *, correction: bool) -> object:
        instruction = (
            "The previous response failed validation. Return a corrected JSON response "
            "that obeys every grounding and schema rule."
            if correction
            else "Extract the claim units from this source."
        )
        source_payload = json.dumps(source.model_dump(mode="json"), ensure_ascii=False)
        response = await self._client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"{instruction}\n\nsource={source_payload}",
                },
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "claim_extraction",
                    "strict": True,
                    "schema": ClaimDraftResponse.model_json_schema(),
                },
            },
            max_completion_tokens=MAX_COMPLETION_TOKENS,
        )
        content = response.choices[0].message.content
        if not content:
            raise ValueError("empty model response")
        return content


class ClaimExtractor:
    """Validate provider drafts and map them to the canonical Claim contract."""

    def __init__(
        self,
        provider: ClaimDraftProviderProtocol,
        *,
        claim_id_factory: Callable[[], str] | None = None,
    ) -> None:
        self._provider = provider
        self._claim_id_factory = claim_id_factory or (
            lambda: f"clm_{uuid4().hex}"
        )

    async def extract(self, signal_id: str, source: Source) -> list[Claim]:
        if not signal_id:
            raise ValueError("signal_id must not be empty")

        last_error: Exception | None = None
        for attempt in range(MAX_MODEL_ATTEMPTS):
            try:
                payload = await self._provider.generate(
                    source,
                    correction=attempt > 0,
                )
                response = _validate_response(payload)
                _validate_grounding(response, source.raw_text)
                return [self._to_claim(signal_id, draft) for draft in response.claims]
            except Exception as exc:  # noqa: BLE001 - sanitized after bounded retry
                last_error = exc
                logger.warning(
                    "claim extraction attempt %s failed validation: %s",
                    attempt + 1,
                    type(exc).__name__,
                )

        raise ClaimExtractionError(
            "Claim extraction failed after two attempts."
        ) from last_error

    def _to_claim(self, signal_id: str, draft: ClaimDraft) -> Claim:
        status = (
            "insufficient_evidence"
            if draft.kind in {"fact", "hypothesis"}
            else "not_applicable"
        )
        return Claim(
            claim_id=self._claim_id_factory(),
            signal_id=signal_id,
            kind=draft.kind,
            quote=draft.quote,
            normalized_statement=draft.normalized_statement,
            entities=draft.entities,
            scope=draft.scope,
            verification_status=status,
            evidence=[],
        )


async def extract(
    signal_id: str,
    source: Source,
    *,
    provider: ClaimDraftProviderProtocol,
    claim_id_factory: Callable[[], str] | None = None,
) -> list[Claim]:
    """Convenience boundary for callers that do not retain a service instance."""

    return await ClaimExtractor(
        provider,
        claim_id_factory=claim_id_factory,
    ).extract(signal_id, source)


def _validate_response(payload: object) -> ClaimDraftResponse:
    if isinstance(payload, (str, bytes, bytearray)):
        payload = json.loads(payload)
    if isinstance(payload, BaseModel):
        payload = payload.model_dump()
    if not isinstance(payload, Mapping):
        raise TypeError("structured response must be a JSON object")
    return ClaimDraftResponse.model_validate(payload)


def _validate_grounding(response: ClaimDraftResponse, source_text: str) -> None:
    for draft in response.claims:
        if draft.quote not in source_text:
            raise ClaimGroundingError("claim quote is not an exact source substring")

        folded_quote = draft.quote.casefold()
        for entity in draft.entities:
            if entity.name.casefold() not in folded_quote:
                raise ClaimGroundingError("claim entity is not grounded in its quote")

        for value in (
            draft.scope.region,
            draft.scope.batch,
            draft.scope.time_window,
        ):
            if value is not None and value.casefold() not in folded_quote:
                raise ClaimGroundingError("claim scope is not grounded in its quote")


__all__ = [
    "ClaimDraft",
    "ClaimDraftProviderProtocol",
    "ClaimDraftResponse",
    "ClaimExtractionError",
    "ClaimExtractor",
    "ClaimExtractorProtocol",
    "OpenAIClaimDraftProvider",
    "extract",
]
