# A/M1 implementation tasks

Status: Ready for assignment
Source spec: `SPEC.md`
Workstream: A — synthesized signal ingestion and verification

## How to use this file

Assign one task below to one subagent. Each task is bounded, names the files it owns,
and has an independent verification command. A declared dependency is only a code
merge-order requirement; it is never a request for more product clarification or
teammate approval. Once the dependency commits are present, the assignee must execute
the task directly using the frozen decisions below.

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
- Import the canonical Signal, Claim and Evidence models from `app/schemas.py`; do not
  create a task-local alternative.
- Do not modify a central enum or contract meaning in an implementation task.
- Do not fetch production secrets. Tests must use deterministic fakes and temporary
  SQLite files.
- Do not hold a SQLite write transaction while awaiting an LLM or HTTP call.
- Do not commit, push or deploy unless the user separately authorizes it.
- Preserve unrelated worktree changes.

## Frozen implementation decisions

No task below requires a new answer from A, B, D or the user before it starts:

1. `contracts/README.md` is the field and enum authority. Task A0 translates its
   existing Signal, Claim and Evidence shapes into the one shared Pydantic
   implementation; it does not redesign them.
2. `issues/01a-synthesized-data-handoff.md` is the M1 scenario authority. Task A1
   owns writing the complete committed synthesized pack that satisfies its stages and
   checklist. The content must remain clearly synthetic; no later approval is a task
   completion condition.
3. A hands a new Signal to B through an injected async
   `CaseDispatcherProtocol.dispatch(signal_id: str) -> None`. Implementation and tests
   use this interface directly; defining Case grouping or `Case.signal_ids` is outside
   A and does not block any A task.
4. The two A write endpoints use the exact request/response semantics stated in Task
   A5. No assignee should invent or wait for a second transport contract.
5. Model-backed code reads `OPENAI_MODEL`; tests use deterministic fakes. Model
   benchmarking can change configuration later but is not a coding prerequisite.

Assignment order:

- Wave 1, parallel: A0 and A1.
- Wave 2, parallel after its listed prerequisites: A2, A3, A4 and A6.
- Wave 3: A5.
- Wave 4: A7.

## Task A0 — canonical Signal contract models

### Goal

Turn the existing `contracts/README.md` Signal, Claim and Evidence definitions into
one importable set of shared Pydantic models for A to produce and B to consume.

### Owned files

```text
app/schemas.py
tests/test_signal_contract_models.py
```

Do not add or modify Case, Product, Approval or Execution semantics in this task.

### Work

- Add `Source`, `Entity`, `ClaimScope`, `Evidence`, `Claim` and `Signal` models using
  the existing canonical field names and enums.
- Preserve existing starter planner schemas and behavior.
- Use strict validation for forbidden extra fields, timezone-aware UTC timestamps,
  Claim-to-Signal IDs and Evidence-to-Claim IDs.
- Enforce the existing rule that `supported` and `refuted` Claims cite at least one
  Evidence item; do not add a `mixed` enum.
- Add focused model validation and JSON round-trip tests.
- Keep these as the only Signal-side canonical models; do not create an A-only copy
  in another module.

### Done when

- The example Signal in `contracts/README.md` validates unchanged.
- Invalid enums, missing required fields, naïve timestamps and inconsistent nested
  IDs are rejected.
- Existing planner schema tests remain valid.
- `uv run pytest tests/test_signal_contract_models.py` passes.
- `uv run pytest` still passes, proving the additions preserve starter behavior.

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
- Add the complete five-stage M1 synthesized pack described by the handoff document:
  initial experience, pure repost, independent report or scoped hypothesis, later
  supporting Evidence, and a later refuting or insufficient-Evidence path.
- Choose stable synthetic copy, IDs and expected relationships while implementing the
  pack. Do not pause for copy review; the committed pack becomes the deterministic M1
  baseline and can be revised through an ordinary later diff.

### Done when

- Loading the same file produces the same ordering every time.
- Stage N never returns earlier stages again.
- Missing Evidence IDs, future-stage Evidence, duplicate source IDs and invalid
  repost references fail with typed, sanitized errors.
- The committed pack covers all five stages and contains no claim that its publishers
  or URLs are real.
- `uv run pytest tests/test_demo_loader.py` passes.

## Task A2 — Signal persistence and idempotent ingestion

### Goal

Persist canonical Signals and Claims in SQLite and implement source-level
idempotency and explicit repost semantics.

### Code prerequisite

- Task A0.

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
- Expose a reservation/result boundary that tells the caller whether a provider source
  is new before the caller invokes extraction. Completing a reservation accepts
  already-extracted Claims; this task does not call an LLM or B.
- Use this public service boundary (equivalent sync names are acceptable because all
  methods are local SQLite operations):

  ```python
  reserve_source(source_input) -> IngestionReservation  # contains signal_id and is_new
  complete_signal(signal_id, claims: list[Claim]) -> Signal
  fail_extraction(signal_id, sanitized_error) -> None
  get_signal(signal_id) -> Signal | None
  get_claim(claim_id) -> Claim | None
  append_verification(claim_id, result) -> Claim
  ```

  Runtime `signal_id` is allocated during reservation. Extraction receives that ID
  and returns Claims already linked to it; persistence must not rewrite IDs.
- Return an existing Signal on repeated ingestion and mark it as not requiring
  extraction or dispatch.
- Persist pure reposts as new Signals linked to the original Signal and with no new
  Claims.
- Retain similar independent reports even when their text is identical.
- Expose repository methods that B can use to load a canonical Signal with Claims by
  `signal_id`.
- Expose methods to load a Claim, append a verification attempt, and reconstruct its
  current canonical Evidence without overwriting earlier attempts.
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

### Code prerequisite

- Task A0.

### Owned files

```text
app/claim_extraction.py
tests/test_claim_extraction.py
```

Do not edit `app/planner.py`, `app/schemas.py` or `app/main.py` in this task.

### Work

- Define an injected extractor protocol so tests never call a paid provider.
- Expose `extract(signal_id: str, source: Source) -> list[Claim]`. The structured model
  response omits runtime IDs, Evidence and verification state; application code maps
  each validated draft to a canonical Claim, generates its opaque `claim_id`, copies
  the supplied `signal_id`, and applies the initial status from SPEC section 7.4.
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
supplied synthesized Evidence and returns no unsupported verdict. Persistence is
performed by the composition layer through Task A2's repository.

### Code prerequisites

- Tasks A0 and A1.

### Owned files

```text
app/claim_verification.py
tests/test_claim_verification.py
```

Do not edit `app/planner.py`, `app/schemas.py` or `app/main.py` in this task.

### Work

- Define an injected verifier protocol and a deterministic fake for tests.
- Expose this service boundary:

  ```python
  verify(
      claim: Claim,
      evidence: list[EvidenceInput],
  ) -> ClaimVerificationResult
  ```

  The result contains the new verification status, canonical Evidence items linked
  to the input `claim_id`, attempt count and sanitized failure; it performs no SQLite
  write.
- Implement one structured-output OpenAI call receiving the Claim and only the
  supplied Evidence documents.
- Return the central verification enum and one stance for every input Evidence ID.
- Validate that `supported` cites at least one `supports` Evidence and `refuted` cites
  at least one `refutes` Evidence.
- Map absent, irrelevant, incomplete or unresolved conflicting Evidence to
  `insufficient_evidence`.
- Keep Experience/Request Claims as `not_applicable` when they contain no separately
  checkable proposition.
- Allow two total attempts and return sanitized failed-attempt information for the
  caller to persist.

### Done when

- Supported, refuted, insufficient, conflicting and not-applicable cases are tested.
- The verifier cannot cite an Evidence ID absent from its input.
- No test needs network access or a real OpenAI key.
- `uv run pytest tests/test_claim_verification.py` passes.

## Task A5 — A API and application composition

### Goal

Expose the central A API, compose loader/ingestion/extraction/verification services,
and hand each newly analyzed Signal to B exactly once.

### Code prerequisites

- Tasks A0–A4.

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
- Define the ingest request body exactly as the source dataset item without `stage`:
  `{ "source": {...}, "source_relation": "...", "duplicate_of_source_id": null }`.
  Require `Idempotency-Key` and return the canonical `Signal` with HTTP 200 for both
  first success and an idempotent repeat.
- Define the verify request body exactly as
  `{ "evidence_ids": ["ev_001"], "current_stage": 4 }`. Require
  `Idempotency-Key` and return the updated canonical `Claim` with HTTP 200.
- Compose ingest so an extraction call occurs outside all SQLite write transactions.
- Define the injected async `CaseDispatcherProtocol` in `app/signal_api.py` and call
  `dispatch(signal_id)` only after successful persistence and extraction of a new
  Signal. Tests provide a recording fake; this task does not implement Case logic or
  make an HTTP call to a separately guessed B payload.
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

### Code prerequisites

- Tasks A0 and A1. Fixture content must use the committed M1 pack rather than inventing
  a second scenario.

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
- Validate every fixture with the shared Pydantic models in `app/schemas.py`.
- Ensure the pure repost is still a Signal, links to the original Signal and does not
  introduce duplicate Claims.
- Ensure verification Evidence has source, time, excerpt and stance.

### Done when

- The shared models parse every fixture without aliases or translation code.
- Fixtures do not claim synthesized sources are real-world announcements.
- `uv run pytest tests/test_a_contract_fixtures.py` passes.

## Task A7 — M1 integration and acceptance

### Goal

Exercise the complete A pipeline against the committed staged dataset and verify the
A/B handoff protocol without changing business decisions owned by B.

### Code prerequisites

- Tasks A0–A6.

### Owned files

```text
tests/test_a_m1_acceptance.py
```

Production-module defects found here should be reported to the owning task rather
than fixed through broad cross-module rewrites.

### Work

- Replay stages in deterministic order.
- Use an in-memory recording implementation of `CaseDispatcherProtocol`; no B service
  or teammate setup is required.
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

## Runtime notes (not task blockers)

- A local OpenAI key is not required for unit tests or most implementation tasks.
- A production OpenAI key is already recorded as configured in `INFRA_STATUS.md`; do
  not retrieve or copy it locally.
- To run an optional local live smoke test, the developer places their own key only in
  the ignored root `.env` file:

  ```text
  OPENAI_API_KEY=<developer-owned key>
  OPENAI_MODEL=gpt-5.6-luna
  ```

  Never put the key in chat, Git, `VITE_*`, frontend code, fixtures or test output.
- Threads credentials are not required for M1.
- An explicit `mixed` verification enum is not required; M1 follows the current
  contract and uses `insufficient_evidence` for unresolved conflicting Evidence.
- `Case.signal_ids` and B's eventual HTTP transport are B-side implementation details;
  A's stable handoff is the injected `dispatch(signal_id)` protocol above.
