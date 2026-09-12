from __future__ import annotations

import json
from pathlib import Path

import pytest

from app import demo_loader


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def _valid_source_item(source_id: str = "post_001", stage: int = 1) -> dict[str, object]:
    return {
        "stage": stage,
        "provider": "threads",
        "source_id": source_id,
        "url": f"https://example.test/{source_id}",
        "author_ref": "fictional_user",
        "published_at": "2026-09-12T01:00:00Z",
        "raw_text": "Synthesized test input; not a real report.",
        "source_relation": "original",
        "duplicate_of_source_id": None,
    }


def test_default_loader_uses_d_fixture_files() -> None:
    assert demo_loader.SOURCES_PATH.name == "signals.json"
    assert demo_loader.EVIDENCE_PATH.name == "evidence.json"
    assert demo_loader.SOURCES_PATH.parent == demo_loader.EVIDENCE_PATH.parent
    assert demo_loader.SOURCES_PATH.parent.parts[-3:] == (
        "contracts",
        "fixtures",
        "demo",
    )


def test_d_pack_covers_exactly_six_stages_without_replaying_earlier_items() -> None:
    stage_ids = {
        stage: [item.source.source_id for item in demo_loader.load_sources(stage)]
        for stage in range(1, 7)
    }

    assert stage_ids == {
        1: ["post_001"],
        2: ["post_002"],
        3: ["post_003"],
        4: ["fda_20260701"],
        5: ["fda_20260707"],
        6: ["cna_20260723"],
    }
    assert demo_loader.load_sources(7) == []


def test_source_retrieved_at_is_derived_from_d_published_at() -> None:
    for stage in range(1, 7):
        source = demo_loader.load_sources(stage)[0].source
        assert source.retrieved_at == source.published_at


def test_source_order_is_stable_by_derived_retrieved_at_then_source_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    later_id = _valid_source_item("post_b")
    earlier_id = _valid_source_item("post_a")
    later_time = _valid_source_item("post_c")
    later_time["published_at"] = "2026-09-12T01:02:00Z"
    path = tmp_path / "signals.json"
    _write_json(path, {"items": [later_time, later_id, earlier_id]})
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", path)

    first = [item.source.source_id for item in demo_loader.load_sources(1)]
    second = [item.source.source_id for item in demo_loader.load_sources(1)]

    assert first == second == ["post_a", "post_b", "post_c"]


def test_pack_marks_repost_and_independent_report_explicitly() -> None:
    repost = demo_loader.load_sources(2)[0]
    independent = demo_loader.load_sources(3)[0]

    assert repost.source_relation == "repost"
    assert repost.duplicate_of_source_id == "post_001"
    assert independent.source_relation == "independent_report"
    assert independent.duplicate_of_source_id is None


def test_d_evidence_stage_is_derived_from_matching_signal_url() -> None:
    evidence_ids = [
        "ev_s6_cna_20260723",
        "ev_s4_fda_20260701",
        "ev_s5_fda_20260707",
    ]

    with pytest.raises(demo_loader.EvidenceNotAvailableError) as exc_info:
        demo_loader.load_evidence(evidence_ids, current_stage=4)

    assert exc_info.value.code == "evidence_not_available"
    assert exc_info.value.evidence_ids == (
        "ev_s6_cna_20260723",
        "ev_s5_fda_20260707",
    )
    assert "ev_s6_cna_20260723" not in str(exc_info.value)
    loaded = demo_loader.load_evidence(evidence_ids, current_stage=6)
    assert [(item.evidence_id, item.stage) for item in loaded] == [
        ("ev_s4_fda_20260701", 4),
        ("ev_s5_fda_20260707", 5),
        ("ev_s6_cna_20260723", 6),
    ]


def test_runtime_evidence_excludes_d_golden_claim_and_stance() -> None:
    runtime = demo_loader.load_evidence(["ev_s4_fda_20260701"], current_stage=4)[0]
    payload = runtime.model_dump(mode="json")

    assert "claim_id" not in payload
    assert "stance" not in payload
    assert set(payload) == {
        "stage",
        "evidence_id",
        "url",
        "title",
        "publisher",
        "published_at",
        "retrieved_at",
        "excerpt",
    }


def test_missing_evidence_fails_with_typed_sanitized_error() -> None:
    with pytest.raises(demo_loader.EvidenceNotFoundError) as exc_info:
        demo_loader.load_evidence(["secret-looking-missing-id"], current_stage=6)

    assert exc_info.value.code == "evidence_not_found"
    assert exc_info.value.evidence_ids == ("secret-looking-missing-id",)
    assert "secret-looking-missing-id" not in str(exc_info.value)


@pytest.mark.parametrize("stage", [0, -1, True, 1.5, "1"])
def test_invalid_replay_stage_fails_with_typed_error(stage: object) -> None:
    with pytest.raises(demo_loader.InvalidReplayStageError):
        demo_loader.load_sources(stage)  # type: ignore[arg-type]


def test_duplicate_provider_source_identity_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = _valid_source_item()
    path = tmp_path / "signals.json"
    _write_json(path, {"items": [item, item]})
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", path)

    with pytest.raises(demo_loader.DatasetValidationError) as exc_info:
        demo_loader.load_sources(1)

    assert exc_info.value.dataset == "source"
    assert str(path) not in str(exc_info.value)


@pytest.mark.parametrize(
    ("relation", "duplicate_id", "target_stage"),
    [
        ("repost", None, 1),
        ("repost", "missing", 1),
        ("repost", "post_original", 2),
        ("original", "post_original", 1),
    ],
)
def test_invalid_repost_references_are_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    relation: str,
    duplicate_id: str | None,
    target_stage: int,
) -> None:
    original = _valid_source_item("post_original", stage=target_stage)
    repost = _valid_source_item("post_repost", stage=2)
    repost["source_relation"] = relation
    repost["duplicate_of_source_id"] = duplicate_id
    path = tmp_path / "signals.json"
    _write_json(path, {"items": [original, repost]})
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", path)

    with pytest.raises(demo_loader.DatasetValidationError):
        demo_loader.load_sources(2)


@pytest.mark.parametrize(
    "timestamp",
    ["2026-09-12T01:00:00", "2026-09-12T09:00:00+08:00"],
)
def test_non_utc_source_timestamps_are_rejected(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    timestamp: str,
) -> None:
    item = _valid_source_item()
    item["published_at"] = timestamp
    path = tmp_path / "signals.json"
    _write_json(path, {"items": [item]})
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", path)

    with pytest.raises(demo_loader.DatasetValidationError):
        demo_loader.load_sources(1)


def test_unexpected_envelope_field_and_malformed_json_are_sanitized(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    unexpected = tmp_path / "unexpected.json"
    _write_json(unexpected, {"dataset_version": "m1-v1", "items": []})
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", unexpected)
    with pytest.raises(demo_loader.DatasetValidationError):
        demo_loader.load_sources(1)

    malformed = tmp_path / "malformed.json"
    malformed.write_text("{private invalid content", encoding="utf-8")
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", malformed)
    with pytest.raises(demo_loader.DatasetReadError) as exc_info:
        demo_loader.load_sources(1)
    assert "private invalid content" not in str(exc_info.value)


def test_evidence_without_one_stage_four_to_six_url_match_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    evidence = json.loads(demo_loader.EVIDENCE_PATH.read_text(encoding="utf-8"))
    evidence["items"][0]["url"] = "https://example.test/no-stage-match"
    path = tmp_path / "evidence.json"
    _write_json(path, evidence)
    monkeypatch.setattr(demo_loader, "EVIDENCE_PATH", path)

    with pytest.raises(demo_loader.DatasetValidationError) as exc_info:
        demo_loader.load_evidence(["ev_s4_fda_20260701"], current_stage=6)

    assert exc_info.value.dataset == "evidence"
    assert "no-stage-match" not in str(exc_info.value)
