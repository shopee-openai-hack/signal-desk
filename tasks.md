# A/M1 implementation tasks

Status: Ready for assignment after the gates below  
Source spec: `SPEC.md`  
Workstream: A — synthesized signal ingestion and verification

## How to use this file

Assign one task below to one subagent. Each task is bounded, names the files it owns,
and has an independent verification command. Tasks may run in parallel only when
their declared dependencies are satisfied and their owned files do not overlap.

Every subagent must first read, in order:

1. `AGENTS.md`
2. `README.md`, especially Local development
3. `INTENT.md`
4. `contracts/README.md`
5. `SPEC.md`
6. `issues/01-signal-verification.md`
7. `issues/01a-synthesized-data-handoff.md`

Shared constraints for every task:

- Preserve the existing FastAPI/Pydantic/httpx/OpenAI SDK/SQLite stack.
- Do not create a private alternative to the canonical Signal, Claim or Evidence
  models owned by B.
- Do not modify a central enum or contract meaning without B's coordinated update.
- Do not fetch production secrets. Tests must use deterministic fakes and temporary
  SQLite files.
- Do not hold a SQLite write transaction while awaiting an LLM or HTTP call.
- Do not commit, push or deploy unless the user separately authorizes it.
- Preserve unrelated worktree changes.

## External gates

These are coordination requirements, not A implementation tasks.

### Gate B0 — shared contract readiness

B must provide importable Pydantic models for `Signal`, `Claim` and `Evidence`, and
confirm the request semantics for case dispatch and claim verification. B must also
decide how a Case exposes all related Signals, including pure reposts with no new
Claim; `signal_ids` is the current recommendation.

Until this gate lands, A tasks may build adapters and injected model-call logic, but
must not invent competing canonical models.

### Gate D0 — scenario pack

D must provide the exact staged synthesized posts, Evidence documents and expected
business interpretation described in `issues/01a-synthesized-data-handoff.md`.
Placeholders may be used for unit tests, but M1 acceptance cannot be claimed until
the shared D pack is installed and reviewed.

## Task A1 — synthesized dataset loader

### Goal

Implement deterministic loading and validation of the M1 source and Evidence JSON
resources without any network or LLM call.

### Owned files

```text
app/demo_loader.py
app/demo_data/m1_sources.json
app/demo_data/m1_evidence.json
tests/test_demo_loader.py
```

Do not edit `app/schemas.py` or `app/main.py` in this task.

### Work

- Implement input-only Pydantic models for the provider-neutral dataset envelopes in
  SPEC sections 5.2 and 5.3. These are loader input models, not replacements for the
  shared canonical contract.
- Implement `load_sources(stage)` returning only the requested stage in stable
  `(retrieved_at, source_id)` order.
- Implement `load_evidence(evidence_ids, current_stage)` and prevent early access to
  later-stage Evidence.
- Validate dataset version, unique provider/source identity, UTC timestamps and valid
  repost references.
- Add a minimal placeholder dataset sufficient for unit tests. Clearly mark that D0
  must replace or approve its scenario content.

### Done when

- Loading the same file produces the same ordering every time.
- Stage N never returns earlier stages again.
- Missing Evidence IDs, future-stage Evidence, duplicate source IDs and invalid
  repost references fail with typed, sanitized errors.
- `uv run pytest tests/test_demo_loader.py` passes.

## Task A2 — Signal persistence and idempotent ingestion

### Goal

Persist canonical Signals and Claims in SQLite and implement source-level
idempotency and explicit repost semantics.

### Dependencies

- Gate B0 for canonical model imports.

### Owned files

```text
app/signal_store.py
app/ingestion.py
tests/test_signal_ingestion.py
```

Do not edit `app/store.py`, `app/schemas.py` or `app/main.py` in this task.

### Work

- Add a dedicated repository using the configured SQLite database path.
- Create additive `CREATE TABLE IF NOT EXISTS` schema for Signals, Claims, Evidence,
  verification attempts and idempotency records as required by the spec.
- Treat `(provider, source_id)` as the acquisition identity.
- Return an existing Signal on repeated ingestion without re-extraction or a new
  dispatch request.
- Persist pure reposts as new Signals linked to the original Signal and with no new
  Claims.
- Retain similar independent reports even when their text is identical.
- Expose repository methods that B can use to load a canonical Signal with Claims by
  `signal_id`.
- Keep transactions short and injectable for isolated tests.

### Done when

- Repeated and concurrent ingestion creates one canonical Signal for one provider
  source identity.
- Pure repost and independent-report cases behave as specified.
- A fresh repository instance can read previously written records.
- `uv run pytest tests/test_signal_ingestion.py` passes.

## Task A3 — Claim extraction service

### Goal

Implement one bounded structured-output LLM call that extracts source-grounded Claim
units without over-splitting or inventing scope.

### Dependencies

- Gate B0 for canonical Claim construction.

### Owned files

```text
app/claim_extraction.py
tests/test_claim_extraction.py
```

Do not edit `app/planner.py`, `app/schemas.py` or `app/main.py` in this task.

### Work

- Define an injected extractor protocol so tests never call a paid provider.
- Implement the OpenAI-backed extractor with structured output using the configured
  backend `OPENAI_API_KEY` and `OPENAI_MODEL`.
- Give the model only the current source and attribution metadata; do not enable web
  or other tools.
- Encode the SPEC section 7 granularity and no-inference rules in a concise prompt.
- Enforce a maximum of six Claim units.
- Deterministically validate that every quote is an exact contiguous source substring.
- Reject added entities or scope that cannot be grounded in the quote.
- Map initial verification states according to SPEC section 7.4.
- Allow two total attempts: initial call plus one retry.

### Done when

- An experience-only post yields one Experience Claim.
- A compound same-scope statement is not mechanically split into field-sized Claims.
- A mixed post splits only when kind, scope or verification path differs.
- Invalid quote, invented scope, malformed structured output and exhausted retry paths
  are covered.
- `uv run pytest tests/test_claim_extraction.py` passes without a real API key.

## Task A4 — synthesized Evidence verifier

### Goal

Implement a callable verifier that compares one canonical Claim with explicitly
supplied synthesized Evidence and persists no unsupported verdict.

### Dependencies

- Gate B0 for canonical Claim and Evidence imports.
- Task A1's Evidence loader interface.

### Owned files

```text
app/claim_verification.py
tests/test_claim_verification.py
```

Do not edit `app/planner.py`, `app/schemas.py` or `app/main.py` in this task.

### Work

- Define an injected verifier protocol and a deterministic fake for tests.
- Implement one structured-output OpenAI call receiving the Claim and only the
  supplied Evidence documents.
- Return the central verification enum and one stance for every input Evidence ID.
- Validate that `supported` cites at least one `supports` Evidence and `refuted` cites
  at least one `refutes` Evidence.
- Map absent, irrelevant, incomplete or unresolved conflicting Evidence to
  `insufficient_evidence`.
- Keep Experience/Request Claims as `not_applicable` when they contain no separately
  checkable proposition.
- Allow two total attempts and preserve failed-attempt information.

### Done when

- Supported, refuted, insufficient, conflicting and not-applicable cases are tested.
- The verifier cannot cite an Evidence ID absent from its input.
- No test needs network access or a real OpenAI key.
- `uv run pytest tests/test_claim_verification.py` passes.

## Task A5 — A API and application composition

### Goal

Expose the central A API, compose loader/ingestion/extraction/verification services,
and hand each newly analyzed Signal to B exactly once.

### Dependencies

- Gate B0.
- Tasks A1–A4.

### Owned files

```text
app/signal_api.py
app/main.py
tests/test_signal_api.py
```

This is the only A task allowed to edit `app/main.py`.

### Work

- Implement `POST /api/v1/signals/ingest` following the central error and
  `Idempotency-Key` conventions.
- Implement `POST /api/v1/claims/{claim_id}/verify` with explicit synthesized
  `evidence_ids` and current replay stage.
- Compose ingest so an extraction call occurs outside all SQLite write transactions.
- Call B's dispatcher with `signal_id` only after successful persistence and
  extraction of a new Signal.
- Dispatch pure repost Signals even though they contain no new Claim.
- Do not dispatch repeated ingestion or a source with failed extraction as a normally
  analyzed Signal.
- Preserve the current middleware, origin checks, request-size limit and existing
  starter endpoints.

### Done when

- API tests cover success, validation, idempotent replay, repost dispatch,
  extraction failure, verification and B-dispatch failure.
- One failing subsystem never produces a false success response.
- `uv run pytest tests/test_signal_api.py` passes.

## Task A6 — canonical A fixtures for B

### Goal

Publish canonical, deterministic fixture outputs that B can consume before the live A
pipeline is integrated.

### Dependencies

- Gate B0.
- Gate D0 for final acceptance content.

### Owned files

```text
contracts/fixtures/a_initial_experience.json
contracts/fixtures/a_pure_repost.json
contracts/fixtures/a_independent_report.json
contracts/fixtures/a_checkable_claim.json
contracts/fixtures/a_supported_verification.json
contracts/fixtures/a_refuted_or_insufficient_verification.json
tests/test_a_contract_fixtures.py
```

Do not change `contracts/README.md` or shared enums in this task.

### Work

- Create the six canonical fixtures required by SPEC section 10.3.
- Use stable fixture IDs and explicit UTC timestamps.
- Validate every fixture with B's shared Pydantic models.
- Ensure the pure repost is still a Signal, links to the original Signal and does not
  introduce duplicate Claims.
- Ensure verification Evidence has source, time, excerpt and stance.

### Done when

- B's models parse every fixture without aliases or translation code.
- Fixtures do not claim synthesized sources are real-world announcements.
- `uv run pytest tests/test_a_contract_fixtures.py` passes.

## Task A7 — M1 integration and acceptance

### Goal

Exercise the complete A pipeline against the D-approved staged dataset and verify the
A/B handoff without changing business decisions owned by B.

### Dependencies

- Gates B0 and D0.
- Tasks A1–A6.

### Owned files

```text
tests/test_a_m1_acceptance.py
```

Production-module defects found here should be reported to the owning task rather
than fixed through broad cross-module rewrites.

### Work

- Replay stages in deterministic order.
- Assert each new Signal is persisted and dispatched once.
- Assert a repeated source is not redispatched.
- Assert pure reposts remain visible without adding independent Evidence.
- Assert independent reports survive ingestion.
- Verify at least one supported path and one refuted or insufficient path.
- Assert old source, Claim and verification inputs remain readable after later stages.
- Run the full repository checks after the focused test passes.

### Done when

```sh
uv run pytest tests/test_a_m1_acceptance.py
uv run pytest
cd frontend && npm run typecheck && npm run build
git diff --check
```

All commands pass, or environment-only failures are reported separately from product
acceptance.

## User and teammate confirmations

### Required before final M1 acceptance

1. Identify the D owner and obtain approval of the exact staged source/evidence pack.
2. Ask B to land the shared Pydantic models and decide how Cases expose Signals that
   contain no new Claim.
3. Ask B to confirm the exact dispatch and verify request/response bodies.
4. Confirm whether the existing `OPENAI_MODEL=gpt-4o-mini` remains the M1 model. It is
   the recommended default unless the team has a measured reason to change it.

### Not required to start implementation

- A local OpenAI key is not required for unit tests or most implementation tasks.
- A production OpenAI key is already recorded as configured in `INFRA_STATUS.md`; do
  not retrieve or copy it locally.
- To run an optional local live smoke test, the developer places their own key only in
  the ignored root `.env` file:

  ```text
  OPENAI_API_KEY=<developer-owned key>
  OPENAI_MODEL=gpt-4o-mini
  ```

  Never put the key in chat, Git, `VITE_*`, frontend code, fixtures or test output.
- Threads credentials are not required for M1.
- An explicit `mixed` verification enum is not required; M1 follows the current
  contract and uses `insufficient_evidence` for unresolved conflicting Evidence.
