# Parallel workstreams

These four work orders split the MVP described in `INTENT.md`:

1. `01-signal-verification.md` — A: source ingestion and verification.
2. `02-case-adaptive.md` — B: case dispatch and adaptive decisions.
3. `03-ui-delisting.md` — C: employee UI and simulated delisting.
4. `04-business-demo.md` — D: business decisions, examples, and demo acceptance.

All engineering work uses `contracts/README.md`. Owners may work against contract
fixtures in parallel. B owns contract coordination; no workstream creates a private
API or data schema. Product scope changes belong in `INTENT.md` first.

The first integration milestone is one signal → one case → candidate products →
employee approval → persistent simulated delisting. Add repost, new evidence, and
adaptive timeline behavior after this path works.
