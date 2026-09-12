from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.schemas import Signal


FIXTURE_DIR = Path(__file__).parents[1] / "contracts" / "fixtures"
DEMO_DATA_DIR = Path(__file__).parents[1] / "app" / "demo_data"
FIXTURE_NAMES = (
    "a_initial_experience.json",
    "a_pure_repost.json",
    "a_independent_report.json",
    "a_checkable_claim.json",
    "a_supported_verification.json",
    "a_refuted_or_insufficient_verification.json",
)


def _load(name: str) -> Signal:
    payload = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
    return Signal.model_validate(payload)


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_every_a_fixture_parses_with_the_shared_model_and_round_trips(name: str) -> None:
    signal = _load(name)

    assert Signal.model_validate_json(signal.model_dump_json()) == signal


def test_initial_experience_is_preserved_without_fabricated_claim_kinds() -> None:
    signal = _load("a_initial_experience.json")

    assert signal.source.source_id == "post_oil_001"
    assert signal.source_relation == "original"
    assert [claim.kind for claim in signal.claims] == ["experience"]
    assert signal.claims[0].verification_status == "not_applicable"
    assert signal.claims[0].quote in signal.source.raw_text


def test_pure_repost_links_to_original_signal_and_adds_no_claims() -> None:
    original = _load("a_initial_experience.json")
    repost = _load("a_pure_repost.json")

    assert repost.source.source_id == "post_oil_repost_001"
    assert repost.source_relation == "repost"
    assert repost.duplicate_of_signal_id == original.signal_id
    assert repost.claims == []


def test_independent_report_is_not_misclassified_as_a_repost() -> None:
    signal = _load("a_independent_report.json")

    assert signal.source.source_id == "post_oil_independent_001"
    assert signal.source_relation == "independent_report"
    assert signal.duplicate_of_signal_id is None
    assert [claim.kind for claim in signal.claims] == ["experience", "hypothesis"]
    assert all(claim.quote in signal.source.raw_text for claim in signal.claims)


def test_checkable_claim_starts_without_a_conclusive_verdict() -> None:
    signal = _load("a_checkable_claim.json")
    claim = signal.claims[0]

    assert signal.source.source_id == "notice_oil_support_001"
    assert claim.kind == "fact"
    assert claim.verification_status == "insufficient_evidence"
    assert claim.evidence == []
    assert claim.quote in signal.source.raw_text


def test_supported_snapshot_cites_matching_synthesized_evidence() -> None:
    signal = _load("a_supported_verification.json")
    claim = signal.claims[0]

    assert claim.claim_id == _load("a_checkable_claim.json").claims[0].claim_id
    assert claim.verification_status == "supported"
    assert [item.stance for item in claim.evidence] == ["supports"]
    assert claim.evidence[0].evidence_id == "ev_oil_support_b123_001"


def test_later_snapshot_exercises_the_refuted_path() -> None:
    signal = _load("a_refuted_or_insufficient_verification.json")
    claim = signal.claims[0]

    assert claim.claim_id == _load("a_checkable_claim.json").claims[0].claim_id
    assert claim.verification_status == "refuted"
    assert [item.stance for item in claim.evidence] == ["refutes"]
    assert claim.evidence[0].evidence_id == "ev_oil_refute_b123_001"


def test_all_provenance_is_explicitly_synthesized_and_uses_reserved_urls() -> None:
    signals = [_load(name) for name in FIXTURE_NAMES]

    for signal in signals:
        assert signal.source.provider == "synthesized"
        assert signal.source.url.startswith("https://example.test/synthesized/")
        assert "合成" in signal.source.raw_text
        assert signal.source.published_at.utcoffset().total_seconds() == 0
        assert signal.source.retrieved_at.utcoffset().total_seconds() == 0
        for claim in signal.claims:
            for evidence in claim.evidence:
                assert evidence.url.startswith("https://example.test/synthesized/")
                assert "fictional" in evidence.publisher.lower()
                assert "合成" in evidence.excerpt
                assert evidence.published_at.utcoffset().total_seconds() == 0
                assert evidence.retrieved_at.utcoffset().total_seconds() == 0


def test_fixture_provenance_matches_the_committed_m1_pack_exactly() -> None:
    source_pack = json.loads(
        (DEMO_DATA_DIR / "m1_sources.json").read_text(encoding="utf-8")
    )
    evidence_pack = json.loads(
        (DEMO_DATA_DIR / "m1_evidence.json").read_text(encoding="utf-8")
    )
    sources_by_id = {
        item["source"]["source_id"]: item["source"] for item in source_pack["items"]
    }
    evidence_by_id = {
        item["evidence_id"]: item for item in evidence_pack["items"]
    }

    for name in FIXTURE_NAMES:
        signal = _load(name)
        fixture_source = signal.source.model_dump(mode="json", exclude={"retrieval_status"})
        assert fixture_source == sources_by_id[signal.source.source_id]
        for claim in signal.claims:
            for evidence in claim.evidence:
                fixture_evidence = evidence.model_dump(
                    mode="json", exclude={"claim_id", "stance"}
                )
                packed_evidence = dict(evidence_by_id[evidence.evidence_id])
                packed_evidence.pop("stage")
                assert fixture_evidence == packed_evidence
