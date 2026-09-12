from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.schemas import Signal


def example_signal() -> dict:
    return {
        "signal_id": "sig_001",
        "source": {
            "provider": "threads",
            "source_id": "post_123",
            "url": "https://example.test/post/123",
            "author_ref": None,
            "published_at": "2026-09-12T02:00:00Z",
            "retrieved_at": "2026-09-12T02:01:00Z",
            "raw_text": "Original source text",
            "retrieval_status": "succeeded",
        },
        "source_relation": "original",
        "duplicate_of_signal_id": None,
        "claims": [
            {
                "claim_id": "clm_001",
                "signal_id": "sig_001",
                "kind": "fact",
                "quote": "Exact source excerpt",
                "normalized_statement": "A named oil product may have a safety issue",
                "entities": [{"type": "brand", "name": "Demo Brand"}],
                "scope": {"region": None, "batch": None, "time_window": None},
                "verification_status": "insufficient_evidence",
                "evidence": [],
            }
        ],
    }


def example_evidence() -> dict:
    return {
        "evidence_id": "ev_001",
        "claim_id": "clm_001",
        "url": "https://example.test/evidence/001",
        "title": "Synthesized food-safety notice",
        "publisher": "Synthesized authority",
        "published_at": "2026-09-12T03:00:00Z",
        "retrieved_at": "2026-09-12T03:01:00Z",
        "excerpt": "Demo Brand batch B123 failed inspection.",
        "stance": "supports",
    }


def test_contract_example_validates_unchanged_and_round_trips_as_json() -> None:
    payload = example_signal()

    signal = Signal.model_validate(payload)
    restored = Signal.model_validate_json(signal.model_dump_json())

    assert restored == signal
    assert restored.signal_id == "sig_001"
    assert restored.claims[0].entities[0].name == "Demo Brand"
    assert restored.source.published_at.utcoffset().total_seconds() == 0


@pytest.mark.parametrize(
    ("path", "invalid_value"),
    [
        (("source_relation",), "duplicate"),
        (("claims", 0, "kind"), "opinion"),
        (("claims", 0, "verification_status"), "mixed"),
    ],
)
def test_invalid_canonical_enums_are_rejected(
    path: tuple[str | int, ...], invalid_value: str
) -> None:
    payload = example_signal()
    target: dict | list = payload
    for part in path[:-1]:
        target = target[part]  # type: ignore[index,assignment]
    target[path[-1]] = invalid_value  # type: ignore[index]

    with pytest.raises(ValidationError):
        Signal.model_validate(payload)


@pytest.mark.parametrize(
    "timestamp_path",
    [
        ("source", "published_at"),
        ("source", "retrieved_at"),
        ("claims", 0, "evidence", 0, "published_at"),
        ("claims", 0, "evidence", 0, "retrieved_at"),
    ],
)
def test_naive_timestamps_are_rejected(timestamp_path: tuple[str | int, ...]) -> None:
    payload = example_signal()
    if "evidence" in timestamp_path:
        payload["claims"][0]["evidence"] = [example_evidence()]
    target: dict | list = payload
    for part in timestamp_path[:-1]:
        target = target[part]  # type: ignore[index,assignment]
    target[timestamp_path[-1]] = "2026-09-12T03:00:00"  # type: ignore[index]

    with pytest.raises(ValidationError, match="UTC timezone"):
        Signal.model_validate(payload)


def test_non_utc_timestamp_is_rejected() -> None:
    payload = example_signal()
    payload["source"]["published_at"] = "2026-09-12T10:00:00+08:00"

    with pytest.raises(ValidationError, match="must be UTC"):
        Signal.model_validate(payload)


def test_claim_must_reference_parent_signal() -> None:
    payload = example_signal()
    payload["claims"][0]["signal_id"] = "sig_other"

    with pytest.raises(ValidationError, match="parent Signal"):
        Signal.model_validate(payload)


def test_evidence_must_reference_parent_claim() -> None:
    payload = example_signal()
    evidence = example_evidence()
    evidence["claim_id"] = "clm_other"
    payload["claims"][0]["evidence"] = [evidence]

    with pytest.raises(ValidationError, match="parent Claim"):
        Signal.model_validate(payload)


@pytest.mark.parametrize("status", ["supported", "refuted"])
def test_conclusive_verification_requires_evidence(status: str) -> None:
    payload = example_signal()
    payload["claims"][0]["verification_status"] = status

    with pytest.raises(ValidationError, match="must cite Evidence"):
        Signal.model_validate(payload)


def test_conclusive_verification_accepts_cited_evidence() -> None:
    payload = example_signal()
    payload["claims"][0]["verification_status"] = "supported"
    payload["claims"][0]["evidence"] = [example_evidence()]

    assert Signal.model_validate(payload).claims[0].evidence[0].stance == "supports"


@pytest.mark.parametrize(
    ("container_path", "field"),
    [
        ((), "signal_id"),
        (("source",), "provider"),
        (("claims", 0), "scope"),
        (("claims", 0, "scope"), "batch"),
    ],
)
def test_required_contract_fields_cannot_be_omitted(
    container_path: tuple[str | int, ...], field: str
) -> None:
    payload = example_signal()
    target: dict | list = payload
    for part in container_path:
        target = target[part]  # type: ignore[index,assignment]
    del target[field]  # type: ignore[index]

    with pytest.raises(ValidationError):
        Signal.model_validate(payload)


@pytest.mark.parametrize(
    "container_path",
    [(), ("source",), ("claims", 0), ("claims", 0, "scope")],
)
def test_extra_fields_are_forbidden(container_path: tuple[str | int, ...]) -> None:
    payload = deepcopy(example_signal())
    target: dict | list = payload
    for part in container_path:
        target = target[part]  # type: ignore[index,assignment]
    target["unexpected"] = True  # type: ignore[index]

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        Signal.model_validate(payload)
