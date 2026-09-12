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
        "source": {
            "provider": "synthesized",
            "source_id": source_id,
            "url": f"https://example.test/{source_id}",
            "author_ref": "fictional_user",
            "published_at": "2026-09-12T01:00:00Z",
            "retrieved_at": "2026-09-12T01:01:00Z",
            "raw_text": "Synthesized test input; not a real report.",
        },
        "source_relation": "original",
        "duplicate_of_source_id": None,
    }


def test_pack_covers_exactly_five_stages_without_replaying_earlier_items() -> None:
    stage_ids = {
        stage: [item.source.source_id for item in demo_loader.load_sources(stage)]
        for stage in range(1, 6)
    }

    assert stage_ids == {
        1: ["post_oil_001"],
        2: ["post_oil_repost_001"],
        3: ["post_oil_independent_001"],
        4: ["notice_oil_support_001"],
        5: ["notice_oil_refute_001"],
    }
    assert demo_loader.load_sources(6) == []


def test_source_order_is_stable_by_retrieved_at_then_source_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    later_id = _valid_source_item("post_b")
    earlier_id = _valid_source_item("post_a")
    later_time = _valid_source_item("post_c")
    later_time["source"]["retrieved_at"] = "2026-09-12T01:02:00Z"  # type: ignore[index]
    path = tmp_path / "sources.json"
    _write_json(
        path,
        {"dataset_version": "m1-v1", "items": [later_time, later_id, earlier_id]},
    )
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", path)

    first = [item.source.source_id for item in demo_loader.load_sources(1)]
    second = [item.source.source_id for item in demo_loader.load_sources(1)]

    assert first == second == ["post_a", "post_b", "post_c"]


def test_pack_marks_repost_and_independent_report_explicitly() -> None:
    repost = demo_loader.load_sources(2)[0]
    independent = demo_loader.load_sources(3)[0]

    assert repost.source_relation == "repost"
    assert repost.duplicate_of_source_id == "post_oil_001"
    assert independent.source_relation == "independent_report"
    assert independent.duplicate_of_source_id is None


def test_evidence_is_deterministic_and_gated_by_current_stage() -> None:
    evidence_ids = ["ev_oil_refute_b123_001", "ev_oil_support_b123_001"]

    with pytest.raises(demo_loader.EvidenceNotAvailableError) as exc_info:
        demo_loader.load_evidence(evidence_ids, current_stage=4)

    assert exc_info.value.code == "evidence_not_available"
    assert exc_info.value.evidence_ids == ("ev_oil_refute_b123_001",)
    assert "ev_oil_refute_b123_001" not in str(exc_info.value)
    loaded = demo_loader.load_evidence(evidence_ids, current_stage=5)
    assert [item.evidence_id for item in loaded] == [
        "ev_oil_support_b123_001",
        "ev_oil_refute_b123_001",
    ]


def test_missing_evidence_fails_with_typed_sanitized_error() -> None:
    with pytest.raises(demo_loader.EvidenceNotFoundError) as exc_info:
        demo_loader.load_evidence(["secret-looking-missing-id"], current_stage=5)

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
    path = tmp_path / "sources.json"
    _write_json(path, {"dataset_version": "m1-v1", "items": [item, item]})
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
    path = tmp_path / "sources.json"
    _write_json(
        path, {"dataset_version": "m1-v1", "items": [original, repost]}
    )
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
    item["source"]["published_at"] = timestamp  # type: ignore[index]
    path = tmp_path / "sources.json"
    _write_json(path, {"dataset_version": "m1-v1", "items": [item]})
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", path)

    with pytest.raises(demo_loader.DatasetValidationError):
        demo_loader.load_sources(1)


def test_wrong_dataset_version_and_malformed_json_are_sanitized(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    wrong_version = tmp_path / "wrong-version.json"
    _write_json(wrong_version, {"dataset_version": "future", "items": []})
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", wrong_version)
    with pytest.raises(demo_loader.DatasetValidationError):
        demo_loader.load_sources(1)

    malformed = tmp_path / "malformed.json"
    malformed.write_text("{private invalid content", encoding="utf-8")
    monkeypatch.setattr(demo_loader, "SOURCES_PATH", malformed)
    with pytest.raises(demo_loader.DatasetReadError) as exc_info:
        demo_loader.load_sources(1)
    assert "private invalid content" not in str(exc_info.value)


def test_pack_is_explicitly_fictional_and_uses_reserved_example_urls() -> None:
    all_sources = [
        item for stage in range(1, 6) for item in demo_loader.load_sources(stage)
    ]
    all_evidence = demo_loader.load_evidence(
        ["ev_oil_support_b123_001", "ev_oil_refute_b123_001"],
        current_stage=5,
    )

    assert all(item.source.url.startswith("https://example.test/") for item in all_sources)
    assert all("合成" in item.source.raw_text for item in all_sources)
    assert all(item.url.startswith("https://example.test/") for item in all_evidence)
    assert all("fictional" in item.publisher.lower() for item in all_evidence)
