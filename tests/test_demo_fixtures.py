import json
from datetime import datetime, timezone
from pathlib import Path


FIXTURES = Path(__file__).parents[1] / "contracts" / "fixtures" / "demo"

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

    ordered = sorted(signals, key=lambda item: item["stage"])
    assert [item["stage"] for item in ordered] == list(range(1, 7))
    signal_times = [utc_timestamp(item["published_at"]) for item in ordered]
    assert signal_times == sorted(signal_times) and len(set(signal_times)) == 6
    for item in evidence:
        assert utc_timestamp(item["published_at"]) <= utc_timestamp(item["retrieved_at"])


def test_fixture_references_and_delisting_are_consistent():
    signals = load("signals.json")["items"]
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
