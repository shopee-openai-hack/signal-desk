# B — Case dispatch and evidence-driven adaptation

Read `INTENT.md` and `contracts/README.md` before implementation.

## Deliverables

- Route signals to an existing case or create a separate case and case specialist.
- Consolidate equivalent claims while preserving conflicting and new claims.
- Avoid repeated verification or work for pure reposts; retain independent reports.
- Update impact, priority, unknowns, next steps, candidate products, and monitoring.
- Support escalation, downgrade, and no-change decisions with traceable reasons.
- Store immutable case revisions and timeline items.
- Implement replay/scheduling boundaries, concurrency limits, and stop/reopen rules.
- Provide case fixtures matching the central contract for C.

## Boundaries and handoff

B owns shared Pydantic contract models, case persistence, dispatcher, specialist,
and backend composition. A owns source and verifier internals. C owns product state,
approval, execution, and UI. B must not mutate product status directly.

## Acceptance criteria

- One evolving food-safety case keeps context; an unrelated case remains separate.
- New or conflicting evidence can raise or lower priority; truth and urgency differ.
- Old judgments remain visible and each change cites its inputs.
- Monitoring targets and next-check time have explicit reasons and budget limits.
- New candidate products do not inherit an earlier approval.

Intent coverage: INT-G2/G6–G9 and INT-S8–S10/S12/S13. Own Q7/Q8/Q10/Q11;
implement Q5/Q9 after D defines their business boundaries.
