# Shared API and data contract

This directory is the integration contract for all four workstreams. `INTENT.md`
remains the source of truth for product scope. When code and this contract differ,
do not silently adapt either side: update this file in a small reviewable commit,
notify the owners of every affected workstream, then update producers before
consumers.

## Ownership and change rules

- B coordinates changes to this central contract. A implements the canonical shared
  Pydantic models for Signal, Claim and Evidence in `app/schemas.py`; B consumes those
  models and owns the Case-side models. C owns its Product, Approval and Execution
  models. D reviews business meanings and examples.
- API paths are relative and versioned under `/api/v1`.
- JSON uses `snake_case`, UTC ISO 8601 timestamps, opaque string IDs, and explicit
  `null` for unknown optional values. Never infer missing facts from another post.
- Additive optional fields are compatible. Renames, removals, enum changes, and
  semantic changes require a coordinated contract update.
- Persist immutable timeline entries. New evidence creates a new event revision;
  it does not overwrite the prior judgment.
- All write requests accept `Idempotency-Key`. Repeating a successful request with
  the same key returns the same result and creates no duplicate work.
- Mutable resources carry integer `version`. Stale writes return HTTP `409` with
  error code `version_conflict`.
- Standard error body:

```json
{"error":{"code":"version_conflict","message":"Human-readable message","details":{}}}
```

## Canonical enums

```text
signal_kind       = fact | experience | hypothesis | request
source_relation   = original | repost | independent_report | unknown
verification      = supported | refuted | insufficient_evidence | not_applicable
business_impact   = opportunity | risk | bidirectional | no_material_impact | pending
priority          = low | medium | high | critical
case_status       = monitoring | investigating | awaiting_approval | actioned | closed
product_relation  = candidate | confirmed | excluded
product_status    = active | delisted
approval_status   = proposed | approved | rejected
execution_status  = pending | succeeded | failed
timeline_kind     = signal_added | verification_updated | assessment_updated |
                    monitoring_updated | approval_recorded | action_executed
```

`verification` describes whether evidence supports a claim. `business_impact`
describes platform impact. `priority` describes investigation urgency. These are
independent fields.

## Core resources

### Signal and claim — A produces, B consumes

```json
{
  "signal_id": "sig_001",
  "source": {
    "provider": "threads",
    "source_id": "post_123",
    "url": "https://example.test/post/123",
    "author_ref": null,
    "published_at": "2026-09-12T02:00:00Z",
    "retrieved_at": "2026-09-12T02:01:00Z",
    "raw_text": "Original source text",
    "retrieval_status": "succeeded"
  },
  "source_relation": "original",
  "duplicate_of_signal_id": null,
  "claims": [
    {
      "claim_id": "clm_001",
      "signal_id": "sig_001",
      "kind": "fact",
      "quote": "Exact source excerpt",
      "normalized_statement": "A named oil product may have a safety issue",
      "entities": [{"type":"brand","name":"Demo Brand"}],
      "scope": {"region":null,"batch":null,"time_window":null},
      "verification_status": "insufficient_evidence",
      "evidence": []
    }
  ]
}
```

Evidence items contain `evidence_id`, `claim_id`, `url`, `title`, `publisher`,
`published_at`, `retrieved_at`, `excerpt`, and `stance` (`supports`, `refutes`,
or `context_only`). A verification result must cite at least one evidence item
unless its status is `insufficient_evidence` or `not_applicable`.

### Case snapshot and timeline — B produces, C consumes

```json
{
  "case_id": "case_001",
  "version": 3,
  "title": "Demo edible-oil safety concern",
  "status": "investigating",
  "business_impact": "risk",
  "priority": "high",
  "priority_reasons": ["Potential consumer harm", "Platform products may match"],
  "owner": {"type":"case_agent","id":"agent_food_safety"},
  "claim_ids": ["clm_001"],
  "unknowns": ["Affected batch is not yet confirmed"],
  "next_steps": ["Check official announcement", "Compare candidate products"],
  "monitoring_plan": {
    "targets": ["Demo Brand", "official food-safety announcements"],
    "next_check_at": "2026-09-12T02:15:00Z",
    "reason": "High potential harm with incomplete evidence"
  },
  "candidate_products": [
    {
      "product_id":"prod_001",
      "relation":"candidate",
      "reason":"Brand matches; batch unknown",
      "missing_information":["batch"]
    }
  ],
  "updated_at": "2026-09-12T02:05:00Z"
}
```

A timeline item contains `timeline_id`, `case_id`, `case_version`, `kind`,
`occurred_at`, `summary`, `reason`, `source_refs`, and `actor`. `summary` and
`reason` are evidence-backed decision summaries, never private model reasoning.

### Product, approval, and execution — C owns; B consumes outcomes

```json
{
  "product_id": "prod_001",
  "name": "Demo Oil 1L",
  "brand": "Demo Brand",
  "batch": null,
  "seller_id": "seller_demo",
  "status": "active",
  "version": 1,
  "is_simulated": true
}
```

```json
{
  "approval_id": "apr_001",
  "case_id": "case_001",
  "case_version": 3,
  "product_ids": ["prod_001"],
  "status": "approved",
  "approved_by": "employee_demo",
  "approved_at": "2026-09-12T02:10:00Z"
}
```

Execution records contain `execution_id`, `approval_id`, `product_id`,
`status`, `error`, and `executed_at`. Approval applies only to the listed product
IDs and case version. Newly discovered products require a new approval.

## API surface

| Method | Path | Owner | Purpose |
|---|---|---|---|
| POST | `/api/v1/signals/ingest` | A | Store source, extract claims, return signal |
| POST | `/api/v1/claims/{claim_id}/verify` | A | Run or replay external verification |
| POST | `/api/v1/cases/dispatch` | B | Route a signal to an existing or new case |
| GET | `/api/v1/cases` | B | List case summaries |
| GET | `/api/v1/cases/{case_id}` | B | Return canonical case snapshot |
| GET | `/api/v1/cases/{case_id}/timeline` | B | Return ordered immutable timeline |
| POST | `/api/v1/cases/{case_id}/advance` | B | Process new evidence and create a revision |
| GET | `/api/v1/products` | C | Query simulated products |
| POST | `/api/v1/cases/{case_id}/approvals` | C | Record human product selection and approval |
| POST | `/api/v1/approvals/{approval_id}/execute` | C | Delist approved simulated products |

List endpoints return `{ "items": [...], "next_cursor": null }`. During parallel
development, each owner supplies fixtures matching this contract in
`contracts/fixtures/`; consumers must work against fixtures before integration.

## Cross-workstream integration gates

1. A fixture can be dispatched by B without field translation.
2. B's case fixture renders in C with no frontend-only business inference.
3. C's execution result returns to B and appears as one timeline entry.
4. The end-to-end demo preserves old case versions and never delists an
   unapproved or newly discovered product.
