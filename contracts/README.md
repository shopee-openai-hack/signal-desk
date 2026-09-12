# Shared API and data contract

This directory is the integration contract for all four workstreams. `INTENT.md`
remains the source of truth for product scope. When code and this contract differ,
do not silently adapt either side: update this file in a small reviewable commit,
notify the owners of every affected workstream, then update producers before
consumers.

## Frontend read-model handoff — B review (2026-09-12)

The frontend branch now has a local HTTP mock for four user-approved read needs:
`GET /api/v1/signals`, `GET /api/v1/cases/{case_id}/agent-status`,
`GET /api/v1/traces` and `GET /api/v1/traces/{trace_id}`, and
`GET /api/v1/cases/{case_id}/approvals` (including execution results).
The paths and user needs are accepted as integration targets. This B branch now
serves the Signal inbox and agent-status reads against the merged A store.
Trace and approval reads remain Node-mock proposals until their producers land;
A/C/front-end owners should review the field rules before publication.

See [frontend sync handoff](../frontend/SYNC_STATUS.md) for responsibilities and
acceptance boundaries, [mock integration notes](../frontend/README.md) for current
responses, and [rich Trace schema proposal](../frontend/TRACE_CONTRACT_PROPOSAL.md)
for phase/activity snapshots, observable agent work, and retry history. The rich
Trace producer and tests are available; the vertical UI consumer is still pending.
B has reviewed the mock responses, TypeScript types and API client. Saved Trace
playback must remain read-only and distinct
from both live execution and the canonical case timeline.

| Read path | Proposed producer | Shape and integration rule |
|---|---|---|
| `GET /api/v1/signals` | A store, B case-link lookup | `{items: SignalRead[], next_cursor}`; each item has the canonical Signal fields plus `case_id: string|null`. `null` means persisted but not yet assigned. A's source and claim store remains authoritative. Implemented on the B integration branch. |
| `GET /api/v1/cases/{case_id}/agent-status` | B/orchestrator | Persisted observation with `case_id`, `agent_id`, `state`, `current_step`, `latest_result`, `waiting_reason`, `next_action`, `observed_at`, `source`. B now saves waiting observations after completed Case work and serves this read; an unavailable observation returns 404. Do not infer `running` from the Case status or monitoring plan. |
| `GET /api/v1/traces`, `GET /api/v1/traces/{trace_id}` | Replay/trace producer, to be assigned | Paginated summaries and immutable rich `phases`/`activities` detail as in `frontend/TRACE_CONTRACT_PROPOSAL.md`; legacy `steps` is temporary UI compatibility. Reading a trace never advances a Case. |
| `GET /api/v1/cases/{case_id}/approvals` | C | `{items: ApprovalRecord[], next_cursor}` with each approval's per-product execution, stable IDs, failure and retry attempts. |

The mock currently gives a `case_id` to every Signal; the real inbox must permit
`null` until dispatch completes. Case list summaries contain `latest_change`,
`next_check_at` and nullable `agent_state`. Canonical Case detail snapshots do
not duplicate those display fields. A summary's `updated_at` includes later
timeline activity such as a repost; the canonical snapshot's `updated_at`
remains the assessment revision time. Timeline `actor` is an `{type,id}` object.
These distinctions are reflected in B's producer models and the frontend types.

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
`actor` uses the same `{type,id}` shape as Case `owner`. A pure repost creates
one `signal_added` item pointing at both the repost and original Signal. It
does not add a Claim, call a verifier, create an assessment revision or change
Case `version`; its timeline item cites the current Case version.

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
| GET | `/api/v1/signals` | A + B | Read canonical Signals with nullable Case assignment |
| POST | `/api/v1/claims/{claim_id}/verify` | A | Run or replay external verification |
| POST | `/api/v1/cases/dispatch` | B | Route a signal to an existing or new case |
| GET | `/api/v1/cases` | B | List case summaries |
| GET | `/api/v1/cases/{case_id}` | B | Return canonical case snapshot |
| GET | `/api/v1/cases/{case_id}/timeline` | B | Return ordered immutable timeline |
| GET | `/api/v1/cases/{case_id}/agent-status` | B | Read last persisted agent observation |
| POST | `/api/v1/cases/{case_id}/advance` | B | Process new evidence and create a revision |
| GET | `/api/v1/products` | C | Query simulated products |
| POST | `/api/v1/cases/{case_id}/approvals` | C | Record human product selection and approval |
| POST | `/api/v1/approvals/{approval_id}/execute` | C | Delist approved simulated products |

### B request bodies for controlled replay

The orchestrator passes A's canonical stored signal ID to B. In-process A
ingestion calls `CaseDispatcherProtocol.dispatch(signal_id)` after persisting
the Signal. B's `InProcessCaseDispatcher` uses a stable idempotency key and B
reads from A's injected `SQLiteSignalStore.get_signal`. The B-only
`CaseStore.save_signal` seeds isolated tests and must not be called in an
integrated app. An integrated app must inject the real dispatcher; A's default
no-op dispatcher would otherwise mark Signals dispatched without creating Cases.

`POST /api/v1/cases/dispatch` accepts:

```json
{"signal_id":"sig_001","replay_at":"2026-09-12T02:05:00Z"}
```

`replay_at` is optional. Use it only for a labeled controlled demo replay; live
processing uses server time. A's in-process handoff uses the Signal's
`source.retrieved_at` for deterministic replay event time. The response is the
canonical case snapshot. B's LLM receives A's full existing Signals for each
candidate Case so routing can compare source content, not only Case titles and
Claim IDs.

`POST /api/v1/cases/{case_id}/advance` accepts a case version and A's latest
verification results:

```json
{
  "expected_version": 3,
  "verification_updates": [{
    "claim_id": "clm_001",
    "verification_status": "insufficient_evidence",
    "evidence": []
  }],
  "replay_at": "2026-09-12T02:15:00Z"
}
```

Each evidence item follows the Evidence fields above. `replay_at` is optional.
The response is the updated case snapshot. B persists a new immutable revision
and timeline items for a verification result even if the assessment stays the same.
The current first
slice requires at least one verification update; due monitoring with no new
evidence is a later integration step.

A's verify API returns a persisted, updated Claim; it does not itself advance
the owning Case. The orchestration step must pass that result to B's `advance`
with the expected Case version. With A's store injected, B rejects an update
whose verdict or Evidence differs from A's persisted Claim; the client cannot
invent a stronger verdict. B's LLM also receives the full updated Claim text
and Evidence, while A remains the owner of verification. A's controlled loader chooses stage-local
sources and gates Evidence by `current_stage`; the real API call has
`{evidence_ids, current_stage}` and requires `Idempotency-Key`.

The current backend bounds case model calls by the configured per-minute and
daily limits and by maximum concurrent requests. A successful idempotent retry
returns its original case revision without another model call.

B's implementation needs a C-provided simulated-product catalog before it can
propose candidate product IDs. Until that catalog is wired, candidate products
remain empty rather than allowing the model to invent IDs. C can read current
Claim/Evidence views through the Signal inbox; a dedicated Claim detail/history
endpoint has not been assigned.

List endpoints return `{ "items": [...], "next_cursor": null }`. During parallel
development, each owner supplies fixtures matching this contract in
`contracts/fixtures/`; consumers must work against fixtures before integration.

## Cross-workstream integration gates

1. A fixture can be dispatched by B without field translation.
2. B's case fixture renders in C with no frontend-only business inference.
3. C's execution result returns to B and appears as one timeline entry.
4. The end-to-end demo preserves old case versions and never delists an
   unapproved or newly discovered product.

### Open producer/consumer coordination (2026-09-12)

- **A + B composition:** A's canonical store is merged into `main`. This B
  branch injects that store into `CaseStore` and passes a real
  `InProcessCaseDispatcher` to A by default. A's isolated tests can still
  inject their recording dispatcher. A cross-workstream test covers ingest,
  repost, verification, Case advance and the inbox read. These B changes are
  not yet on `main`.
- **B + C products and actions:** C must provide the simulated product catalog
  to B. C's approval and execution outcomes must appear in the Case timeline;
  agree on whether `case.version` covers only B assessment revisions or also
  C's action/status transitions before implementing stale-write checks. New
  Stage 5 products never inherit Stage 4 approvals.
- **Frontend mutations:** The mock's reason-only `advanceCase()` request and
  `{case,previous_version}` response differ from B's versioned
  `verification_updates` request and raw Case response. A production replay
  controller must call A verify and B advance with explicit inputs. Do not
  make the UI button invent Evidence to satisfy the backend.
- **Trace producer:** Assign the saved trace producer and persist its immutable
  phases/activities. The current FastAPI app does not yet implement these
  reads, while the Node mock does. Trace playback remains independent of the
  live Case timeline and write workflow.
