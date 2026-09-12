from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


DATASET_VERSION = "m1-v1"
_DEMO_DATA_DIR = Path(__file__).with_name("demo_data")
SOURCES_PATH = _DEMO_DATA_DIR / "m1_sources.json"
EVIDENCE_PATH = _DEMO_DATA_DIR / "m1_evidence.json"

SourceRelation = Literal["original", "repost", "independent_report", "unknown"]


class DemoDataError(ValueError):
    """Base class for expected, safe-to-surface demo loader failures."""

    code = "demo_data_error"


class InvalidReplayStageError(DemoDataError):
    code = "invalid_replay_stage"

    def __init__(self) -> None:
        super().__init__("Replay stage must be a positive integer.")


class DatasetReadError(DemoDataError):
    code = "dataset_read_error"

    def __init__(self, dataset: Literal["source", "evidence"]) -> None:
        self.dataset = dataset
        super().__init__(f"The {dataset} demo dataset could not be read.")


class DatasetValidationError(DemoDataError):
    code = "dataset_validation_error"

    def __init__(self, dataset: Literal["source", "evidence"]) -> None:
        self.dataset = dataset
        super().__init__(f"The {dataset} demo dataset is invalid.")


class EvidenceNotFoundError(DemoDataError):
    code = "evidence_not_found"

    def __init__(self, evidence_ids: tuple[str, ...]) -> None:
        self.evidence_ids = evidence_ids
        super().__init__("One or more requested Evidence items do not exist.")


class EvidenceNotAvailableError(DemoDataError):
    code = "evidence_not_available"

    def __init__(self, evidence_ids: tuple[str, ...], current_stage: int) -> None:
        self.evidence_ids = evidence_ids
        self.current_stage = current_stage
        super().__init__("One or more requested Evidence items are not available yet.")


def _utc_datetime(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp must be an explicit UTC ISO 8601 string")
    if not (value.endswith("Z") or value.endswith("+00:00")):
        raise ValueError("timestamp must use UTC")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValueError("timestamp must use UTC")
    return parsed


class _InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceRecord(_InputModel):
    provider: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    author_ref: str | None
    published_at: datetime
    retrieved_at: datetime
    raw_text: str = Field(min_length=1)

    _published_at_utc = field_validator("published_at", mode="before")(_utc_datetime)
    _retrieved_at_utc = field_validator("retrieved_at", mode="before")(_utc_datetime)


class SourceInput(_InputModel):
    stage: int = Field(strict=True, ge=1)
    source: SourceRecord
    source_relation: SourceRelation
    duplicate_of_source_id: str | None = None


class SourceDataset(_InputModel):
    dataset_version: Literal["m1-v1"]
    items: tuple[SourceInput, ...]


class EvidenceInput(_InputModel):
    stage: int = Field(strict=True, ge=1)
    evidence_id: str = Field(min_length=1)
    url: str = Field(min_length=1)
    title: str = Field(min_length=1)
    publisher: str = Field(min_length=1)
    published_at: datetime
    retrieved_at: datetime
    excerpt: str = Field(min_length=1)

    _published_at_utc = field_validator("published_at", mode="before")(_utc_datetime)
    _retrieved_at_utc = field_validator("retrieved_at", mode="before")(_utc_datetime)


class EvidenceDataset(_InputModel):
    dataset_version: Literal["m1-v1"]
    items: tuple[EvidenceInput, ...]


def _read_json(path: Path, dataset: Literal["source", "evidence"]) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise DatasetReadError(dataset) from None


def _load_source_dataset() -> SourceDataset:
    try:
        envelope = SourceDataset.model_validate(_read_json(SOURCES_PATH, "source"))
    except ValidationError:
        raise DatasetValidationError("source") from None

    identities: set[tuple[str, str]] = set()
    by_identity: dict[tuple[str, str], SourceInput] = {}
    for item in envelope.items:
        identity = (item.source.provider, item.source.source_id)
        if identity in identities:
            raise DatasetValidationError("source")
        identities.add(identity)
        by_identity[identity] = item

    for item in envelope.items:
        duplicate_id = item.duplicate_of_source_id
        if item.source_relation == "repost":
            if duplicate_id is None:
                raise DatasetValidationError("source")
            target = by_identity.get((item.source.provider, duplicate_id))
            if (
                target is None
                or target.stage >= item.stage
                or target.source_relation == "repost"
            ):
                raise DatasetValidationError("source")
        elif duplicate_id is not None:
            raise DatasetValidationError("source")

    return envelope


def _load_evidence_dataset() -> EvidenceDataset:
    try:
        envelope = EvidenceDataset.model_validate(_read_json(EVIDENCE_PATH, "evidence"))
    except ValidationError:
        raise DatasetValidationError("evidence") from None

    evidence_ids: set[str] = set()
    for item in envelope.items:
        if item.evidence_id in evidence_ids:
            raise DatasetValidationError("evidence")
        evidence_ids.add(item.evidence_id)
    return envelope


def _validate_stage(stage: int) -> None:
    if isinstance(stage, bool) or not isinstance(stage, int) or stage < 1:
        raise InvalidReplayStageError()


def load_sources(stage: int) -> list[SourceInput]:
    """Return only sources introduced at ``stage`` in deterministic order."""

    _validate_stage(stage)
    items = (item for item in _load_source_dataset().items if item.stage == stage)
    return sorted(items, key=lambda item: (item.source.retrieved_at, item.source.source_id))


def load_evidence(
    evidence_ids: list[str], current_stage: int
) -> list[EvidenceInput]:
    """Return requested, currently available Evidence in deterministic order."""

    _validate_stage(current_stage)
    envelope = _load_evidence_dataset()
    by_id = {item.evidence_id: item for item in envelope.items}
    requested_ids = tuple(dict.fromkeys(evidence_ids))

    missing_ids = tuple(evidence_id for evidence_id in requested_ids if evidence_id not in by_id)
    if missing_ids:
        raise EvidenceNotFoundError(missing_ids)

    future_ids = tuple(
        evidence_id
        for evidence_id in requested_ids
        if by_id[evidence_id].stage > current_stage
    )
    if future_ids:
        raise EvidenceNotAvailableError(future_ids, current_stage)

    return sorted(
        (by_id[evidence_id] for evidence_id in requested_ids),
        key=lambda item: (item.retrieved_at, item.evidence_id),
    )
