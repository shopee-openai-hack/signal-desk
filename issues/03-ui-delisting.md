# C — Employee UI, timeline, approval, and simulated delisting

Read `INTENT.md` and `contracts/README.md` before implementation.

## Deliverables

- Build case list and detail views for impact, priority, ownership, and status.
- Render claims, evidence, unknowns, candidate products, and monitoring plan.
- Render immutable timeline changes without mixing proposal, approval, and execution.
- Implement simulated product persistence and product query API.
- Let an employee select products, confirm approval, and execute delisting.
- Persist product and execution state; integrate frontend and backend end to end.
- Use B fixtures first so UI work does not wait for case logic.

## Boundaries and handoff

C owns frontend plus product, approval, and execution modules. Consume B's case
snapshot and timeline without recreating business logic in TypeScript. Publish
product/approval/execution responses through the central contract.

## Acceptance criteria

- Candidate relation and verified claim are visibly different.
- Only selected and approved simulated products change to `delisted`.
- Reload preserves state; unselected and newly found products remain active.
- Failure never appears as success, and repeated execution is idempotent.
- Run frontend typecheck/build and backend tests for writes and persistence.

Intent coverage: INT-G5/G8, INT-S6/S7/S10, and INT-C7–C9/C11. Implement the
resolved INT-Q6; support D on Q2/Q4 and B on Q8.
