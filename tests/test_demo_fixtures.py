import json
from datetime import datetime, timezone
from pathlib import Path


FIXTURES = Path(__file__).parents[1] / "contracts" / "fixtures" / "demo"
CORE_STAGES = set(range(1, 7))
SHOWCASE_STAGES = set(range(101, 111))

ENUMS = {
    "source_relation": {"original", "repost", "independent_report", "unknown"},
    "business_impact": {"opportunity", "risk", "bidirectional", "no_material_impact", "pending"},
    "priority": {"low", "medium", "high", "critical"},
    "case_status": {"monitoring", "investigating", "awaiting_approval", "actioned", "closed"},
    "relation": {"candidate", "confirmed", "excluded"},
    "status": {"active", "delisted"},
    "stance": {"supports", "refutes", "context_only"},
}


def load(name):
    with (FIXTURES / name).open(encoding="utf-8") as fixture:
        return json.load(fixture)


def utc_timestamp(value):
    assert value.endswith("Z")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.tzinfo == timezone.utc
    return parsed


def test_demo_fixture_files_load():
    for name in ("signals.json", "products.json", "evidence.json", "expected_case_states.json"):
        assert load(name)


def test_contract_enums_and_utc_timestamps():
    signals = load("signals.json")["items"]
    products = load("products.json")["items"]
    evidence = load("evidence.json")["items"]
    states = load("expected_case_states.json")["items"]

    assert all(item["source_relation"] in ENUMS["source_relation"] for item in signals)
    assert all(item["status"] in ENUMS["status"] for item in products)
    assert all(item["stance"] in ENUMS["stance"] for item in evidence)
    for state in states:
        assert state["business_impact"] in ENUMS["business_impact"]
        assert state["priority"] in ENUMS["priority"]
        assert state["case_status"] in ENUMS["case_status"]
        assert set(state["expected_product_status"].values()) <= ENUMS["status"]
        assert all(item["relation"] in ENUMS["relation"] for item in state["candidate_products"])

    core = sorted(
        (item for item in signals if item["stage"] in CORE_STAGES),
        key=lambda item: item["stage"],
    )
    showcase = sorted(
        (item for item in signals if item["stage"] in SHOWCASE_STAGES),
        key=lambda item: item["stage"],
    )
    assert [item["stage"] for item in core] == list(range(1, 7))
    assert [item["stage"] for item in showcase] == list(range(101, 111))
    assert {item["stage"] for item in signals} == CORE_STAGES | SHOWCASE_STAGES

    core_times = [utc_timestamp(item["published_at"]) for item in core]
    showcase_times = [utc_timestamp(item["published_at"]) for item in showcase]
    assert core_times == sorted(core_times) and len(set(core_times)) == 6
    assert showcase_times == sorted(showcase_times) and len(set(showcase_times)) == 10
    for item in evidence:
        assert utc_timestamp(item["published_at"]) <= utc_timestamp(item["retrieved_at"])


def test_fixture_references_and_delisting_are_consistent():
    signals = load("signals.json")["items"]
    identities = {(item["provider"], item["source_id"]) for item in signals}
    assert len(identities) == len(signals)

    source_ids = {item["source_id"] for item in signals}
    for item in signals:
        duplicate = item["duplicate_of_source_id"]
        assert duplicate is None or duplicate in source_ids

    product_ids = {item["product_id"] for item in load("products.json")["items"]}
    previous_delisted = set()
    for state in sorted(load("expected_case_states.json")["items"], key=lambda item: item["stage"]):
        referenced = {item["product_id"] for item in state["candidate_products"]}
        assert referenced <= product_ids
        assert set(state["expected_product_status"]) == product_ids
        current_delisted = {
            product_id
            for product_id, status in state["expected_product_status"].items()
            if status == "delisted"
        }
        assert current_delisted >= previous_delisted
        previous_delisted = current_delisted


def test_optional_signal_showcase_covers_relationship_and_conflict_cases():
    signals = {
        item["source_id"]: item
        for item in load("signals.json")["items"]
        if item["stage"] in SHOWCASE_STAGES
    }

    assert signals["post_showcase_002"]["source_relation"] == "repost"
    assert signals["post_showcase_002"]["duplicate_of_source_id"] == "post_showcase_001"
    assert signals["post_showcase_006"]["source_relation"] == "repost"
    assert signals["post_showcase_006"]["duplicate_of_source_id"] == "post_showcase_001"
    assert {
        item["source_id"]
        for item in signals.values()
        if item["source_relation"] == "independent_report"
    } == {
        "post_showcase_003",
        "post_showcase_004",
        "post_showcase_005",
        "post_showcase_008",
        "post_showcase_009",
    }
