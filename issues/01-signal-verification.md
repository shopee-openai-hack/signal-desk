# A — Signal ingestion and external verification

Read `INTENT.md` and `contracts/README.md` before implementation.

M1 synthesized-data ownership and the handoff with D are recorded in
[`01a-synthesized-data-handoff.md`](01a-synthesized-data-handoff.md).

## Deliverables

- Implement general source ingestion plus a callable case-specific retrieval path.
- Preserve source text, URL, source timestamps, retrieval time, and failures.
- Perform exact deduplication while retaining weak and independent signals.
- Extract claims by post with source excerpts, type, entities, and explicit scope.
- Verify externally checkable claims as supported, refuted, or insufficient evidence.
- Send internal-data questions downstream as unresolved instead of inventing a verdict.
- Provide contract fixtures so B can develop before the live adapter is ready.

## Boundaries and handoff

A owns source adapters, extraction, and verification. B owns case routing,
scheduling, and decisions about whether a claim needs rechecking. Follow the
Signal/Claim and evidence contract exactly; do not introduce a second schema.

## Acceptance criteria

- A mixed post can yield separate fact, experience, hypothesis, and request claims.
- Every verdict links to evidence and time; failed retrieval remains visible.
- Repeated ingestion is idempotent. Similar independent reports are not deleted.
- `uv run pytest` covers extraction, deduplication, evidence traceability, and errors.

Intent coverage: INT-G1/G3/G4 and INT-S2/S3/S11. Own INT-Q3; support Q10/Q11.
