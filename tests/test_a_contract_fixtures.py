from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.schemas import Claim, Signal


ROOT = Path(__file__).parents[1]
FIXTURE_DIR = ROOT / "contracts" / "fixtures"
D_FIXTURE_DIR = FIXTURE_DIR / "demo"
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


def _d_signals() -> dict[str, dict[str, object]]:
    envelope = json.loads(
        (D_FIXTURE_DIR / "signals.json").read_text(encoding="utf-8")
    )
    return {item["source_id"]: item for item in envelope["items"]}


def _d_evidence() -> dict[str, dict[str, object]]:
    envelope = json.loads(
        (D_FIXTURE_DIR / "evidence.json").read_text(encoding="utf-8")
    )
    return {item["evidence_id"]: item for item in envelope["items"]}


def _claim(signal: Signal, claim_id: str) -> Claim:
    return next(claim for claim in signal.claims if claim.claim_id == claim_id)


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_every_a_fixture_parses_with_the_shared_model_and_round_trips(name: str) -> None:
    signal = _load(name)

    assert Signal.model_validate_json(signal.model_dump_json()) == signal


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_every_claim_is_grounded_in_its_own_source_quote(name: str) -> None:
    signal = _load(name)

    for claim in signal.claims:
        assert claim.quote in signal.source.raw_text
        for entity in claim.entities:
            assert entity.name.casefold() in claim.quote.casefold()
        for scope_value in (
            claim.scope.region,
            claim.scope.batch,
            claim.scope.time_window,
        ):
            assert scope_value is None or scope_value.casefold() in claim.quote.casefold()


def test_stage_one_preserves_hypothesis_experience_and_request_boundaries() -> None:
    signal = _load("a_initial_experience.json")

    assert signal.source.source_id == "post_001"
    assert signal.source_relation == "original"
    assert [claim.kind for claim in signal.claims] == [
        "hypothesis",
        "experience",
        "request",
    ]
    assert [claim.verification_status for claim in signal.claims] == [
        "insufficient_evidence",
        "not_applicable",
        "not_applicable",
    ]
    experience = _claim(signal, "clm_s1_experience_smell")
    assert experience.entities == []
    assert "泰山" not in experience.normalized_statement


def test_stage_two_repost_links_to_stage_one_and_adds_no_claims() -> None:
    original = _load("a_initial_experience.json")
    repost = _load("a_pure_repost.json")

    assert repost.source.source_id == "post_002"
    assert repost.source_relation == "repost"
    assert repost.duplicate_of_signal_id == original.signal_id
    assert repost.claims == []


def test_stage_three_preserves_new_platform_brand_supplier_and_batch() -> None:
    signal = _load("a_independent_report.json")

    assert signal.source.source_id == "post_003"
    assert signal.source_relation == "independent_report"
    assert signal.duplicate_of_signal_id is None
    assert [claim.kind for claim in signal.claims] == [
        "fact",
        "fact",
        "hypothesis",
    ]
    purchase = _claim(signal, "clm_s3_fact_purchase_batch")
    upstream = _claim(signal, "clm_s3_fact_zhonglian")
    hypothesis = _claim(signal, "clm_s3_hypothesis_supplier")
    assert purchase.scope.batch == "315-1150404"
    assert {(entity.type, entity.name) for entity in purchase.entities} == {
        ("platform", "蝦皮"),
        ("brand", "福壽"),
    }
    assert [(entity.type, entity.name) for entity in upstream.entities] == [
        ("supplier", "中聯油脂")
    ]
    assert {entity.name for entity in hypothesis.entities} == {"福壽", "中聯"}


def test_stage_four_official_signal_has_source_grounded_checkable_claims() -> None:
    signal = _load("a_checkable_claim.json")

    assert signal.source.source_id == "fda_20260701"
    assert signal.source.provider == "fda_tw"
    assert [claim.kind for claim in signal.claims] == ["fact", "fact", "fact"]
    assert all(
        claim.verification_status == "insufficient_evidence"
        and claim.evidence == []
        for claim in signal.claims
    )
    assert _claim(signal, "clm_s4_official_finding").scope.batch == "315-1150404"


def test_stage_four_evidence_supports_the_stage_three_upstream_claim() -> None:
    independent = _load("a_independent_report.json")
    supported = _load("a_supported_verification.json")
    before = _claim(independent, "clm_s3_fact_zhonglian")
    after = _claim(supported, "clm_s3_fact_zhonglian")

    assert supported.signal_id == independent.signal_id
    assert before.verification_status == "insufficient_evidence"
    assert after.verification_status == "supported"
    assert [item.evidence_id for item in after.evidence] == [
        "ev_s4_fda_20260701"
    ]
    assert [item.stance for item in after.evidence] == ["supports"]


def test_final_fixture_keeps_source_grounded_scope_claim_insufficient() -> None:
    signal = _load("a_refuted_or_insufficient_verification.json")
    claim = _claim(signal, "clm_s5_scope_expansion")
    d_golden = _d_evidence()["ev_s6_cna_20260723"]

    assert signal.source.source_id == "fda_20260707"
    assert claim.quote in signal.source.raw_text
    assert claim.verification_status == "insufficient_evidence"
    assert [item.evidence_id for item in claim.evidence] == [
        "ev_s6_cna_20260723"
    ]
    assert [item.stance for item in claim.evidence] == ["context_only"]
    assert d_golden["claim_id"] == "clm_s5_all_expanded_batches_affected"
    assert d_golden["stance"] == "refutes"
    assert "所有批次都仍有問題" not in signal.source.raw_text
    assert all(
        item.claim_id != "clm_s5_all_expanded_batches_affected"
        for item in signal.claims
    )


def test_source_provenance_matches_morris_pack_without_translation() -> None:
    d_by_source_id = _d_signals()
    source_fields = (
        "provider",
        "source_id",
        "url",
        "author_ref",
        "published_at",
        "raw_text",
    )

    for name in FIXTURE_NAMES:
        source = _load(name).source.model_dump(mode="json")
        d_source = d_by_source_id[source["source_id"]]
        for field in source_fields:
            assert source[field] == d_source[field]
        assert source["retrieved_at"] == d_source["published_at"]
        assert source["retrieval_status"] == "succeeded"


def test_evidence_provenance_matches_morris_pack_but_stance_is_a_output() -> None:
    d_by_evidence_id = _d_evidence()
    provenance_fields = (
        "evidence_id",
        "url",
        "title",
        "publisher",
        "published_at",
        "retrieved_at",
        "excerpt",
    )

    for name in FIXTURE_NAMES:
        for claim in _load(name).claims:
            for evidence in claim.evidence:
                actual = evidence.model_dump(mode="json")
                expected = d_by_evidence_id[evidence.evidence_id]
                for field in provenance_fields:
                    assert actual[field] == expected[field]

    supported = _claim(
        _load("a_supported_verification.json"),
        "clm_s3_fact_zhonglian",
    ).evidence[0]
    insufficient = _claim(
        _load("a_refuted_or_insufficient_verification.json"),
        "clm_s5_scope_expansion",
    ).evidence[0]
    assert (supported.claim_id, supported.stance) == (
        "clm_s3_fact_zhonglian",
        "supports",
    )
    assert (insufficient.claim_id, insufficient.stance) == (
        "clm_s5_scope_expansion",
        "context_only",
    )
