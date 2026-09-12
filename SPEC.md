# SPEC — A/M1 controlled demo signal ingestion and verification

Status: Approved for A/M1 implementation
Owner: A — signal ingestion and external verification
Last updated: 2026-09-12

## 1. Purpose

M1 turns a controlled demo market-signal dataset into canonical Signals and Claims
that B can route into evolving Cases. It also provides a callable verifier that
compares a Claim with only the committed Evidence B explicitly selects.

This specification refines the A workstream in `INTENT.md`. `INTENT.md` remains the
product-scope authority, and `contracts/README.md` remains the shared API and data
contract. Implementation tasks follow the frozen decisions in `tasks.md` and do not
pause for additional cross-workstream confirmation.

## 2. M1 outcome

The first milestone must support this controlled sequence:

```text
controlled replay source
→ persisted Signal
→ LLM-extracted Claim units
→ signal_id handed to B
→ B attaches the Signal to a new or existing Case
→ B requests verification for a selected Claim
→ A compares the Claim with selected committed Evidence
→ B receives the persisted verification result
```

M1 succeeds without Threads credentials, live source monitoring, live evidence
search, or a production OpenAI key. Without an OpenAI key, test doubles and committed
expected fixtures cover the pipeline; the deployed demo may use its configured
backend key for extraction and verification.

## 3. Ownership and boundaries

### 3.1 A owns

- Loading the versioned controlled source and Evidence datasets.
- Persisting source text, provenance, source time and retrieval time.
- Idempotent ingestion of the same provider source.
- Preserving explicit repost relationships and independent reports.
- Extracting Claim units from each post with a bounded LLM call.
- Validating extracted output against the shared schema and original text.
- Comparing a Claim with explicitly supplied committed Evidence.
- Persisting verification results, Evidence links and failed attempts.
- Providing canonical Signal fixtures that B can parse without translation.

### 3.2 B owns

- Semantic event grouping and Case routing.
- Deciding whether a Signal joins an existing Case or creates a new Case.
- Consolidating equivalent Claims within a Case.
- Deciding which Claims should be verified or rechecked and when.
- Priority, business impact, unknowns, next steps and monitoring plans.
- Case revisions, timeline entries and Case lifecycle.

For M1, an Event Group is represented by a Case. A does not create a separate Event
resource.

### 3.3 D owns

- The accepted scenario stages and business meaning documented in the A/D handoff.
- Reviewable later revisions to intended source relationships and Evidence meaning.
- Business expectations for escalation, no-change and downgrade paths.

D has materialized the approved requirements as the committed deterministic M1 source
and Evidence files. A1 adapts those files into runtime input without changing their
business meaning or requiring another pre-implementation approval.

Detailed A/D handoff expectations are recorded in
`issues/01a-synthesized-data-handoff.md`.

### 3.4 Out of scope for A/M1

- Threads API integration, pagination, rate limits or app permissions.
- Continuous or scheduled source monitoring.
- Autonomous web search for Evidence.
- Fuzzy event clustering or embedding-based similarity.
- Business-impact or priority decisions.
- Product matching, approval or delisting.
- A complex retry scheduler or background job system.

## 4. Terminology

### 4.1 Signal

A Signal is one acquired source item, such as one post, repost or announcement. A
repost remains a Signal because it represents market activity, but it is not an
independent piece of evidence.

### 4.2 Claim

A Claim is a source-grounded statement unit that can be understood or handled
independently. M1 uses the contract kinds:

- `fact`: the author presents a proposition as factual; this does not mean it is true.
- `experience`: a first-person report or observation.
- `hypothesis`: a conjecture or tentative explanation.
- `request`: a requested action or expressed demand.

Experience and request are Claim kinds. They are preserved even when they are not
suitable for evidence verification.

### 4.3 Evidence

Evidence is a separate document or source excerpt supplied to evaluate a Claim. The
verifier may use only the Evidence passed to it for the current attempt. It must not
fill gaps using unprovided background knowledge.

### 4.4 Event/Case

A Case is B's persistent grouping of related Signals and Claims. New Signals may add
Claims to the same Case over time. Pure reposts can join the Case without adding a new
Claim.

## 5. Controlled demo datasets

### 5.1 Storage

The M1 implementation reads Morris's two committed demo resources:

```text
contracts/fixtures/demo/signals.json
contracts/fixtures/demo/evidence.json
```

Git history versions the files. The Signal file is model input. The Evidence file also
contains D's evaluation-only `claim_id` and `stance`; A validates but strips those two
fields before constructing runtime `EvidenceInput`, so the verifier never receives a
golden answer. Canonical integration fixtures produced by A remain alongside them
under `contracts/fixtures/`.

`products.json` and `expected_case_states.json` are B/C evaluation inputs; A neither
copies them into its store nor turns their business expectations into verifier output.
External-source excerpts retain D's “verify before demo” gate and are never fetched
live during replay.

Stages 1–6 remain the presentation's fixed core replay. Stages 101–110 are an
optional, input-only social-post showcase for extraction, source relationship,
conflict and scope-handling demonstrations. They do not change the six core
case-state expectations and are not part of the timed presentation.

### 5.2 Source dataset shape

The D source dataset uses a flat envelope:

```json
{
  "items": [
    {
      "stage": 1,
      "provider": "threads",
      "source_id": "post_001",
      "url": "https://example.test/post/001",
      "author_ref": "user_001",
      "published_at": "2026-06-30T05:20:00Z",
      "raw_text": "朋友在賣場上班，說今天接到通知要先把泰山某批沙拉油收起來……",
      "source_relation": "original",
      "duplicate_of_source_id": null
    }
  ]
}
```

Requirements:

- `stage` is a positive integer used for controlled replay, not a production time
  scheduler. Stages 1–6 are the core replay; stages 101–110 are the optional signal
  showcase documented in `docs/demo/signal-showcase.md`.
- `published_at` is explicit UTC. D does not provide source `retrieved_at`, so A
  deterministically normalizes it to the same value as `published_at`.
- `source_id` is unique within a provider.
- A repost identifies the original item using `duplicate_of_source_id`.
- The dataset supplies `source_relation` in M1; A does not infer independent-report
  status with an LLM.
- The dataset does not include runtime `signal_id`, `claim_id` or model verdicts.

### 5.3 Evidence dataset shape

```json
{
  "items": [
    {
      "evidence_id": "ev_s4_fda_20260701",
      "claim_id": "clm_s3_fact_zhonglian",
      "url": "https://www.fda.gov.tw/tc/newsContent.aspx?cid=4&id=t634379",
      "title": "中聯油脂原料批號 315-1150404 檢驗與流向公告",
      "publisher": "衛生福利部食品藥物管理署",
      "published_at": "2026-07-01T08:00:00Z",
      "retrieved_at": "2026-07-01T08:01:00Z",
      "excerpt": "中聯油脂批號 315-1150404 大豆沙拉油檢出苯駢芾超標……",
      "stance": "supports"
    }
  ]
}
```

Evidence does not carry an explicit stage. The adapter derives it by uniquely matching
the Evidence URL to the corresponding Stage 4–6 Signal URL. D's `claim_id` and `stance`
are used only by fixture/acceptance evaluation and are excluded from the model input.

### 5.4 Controlled replay

The loader exposes sources in ascending `(stage, retrieved_at, source_id)` order.
Processing stage N returns only items newly available in stage N; it does not return
all earlier Signals again.

```python
load_sources(stage: int) -> list[SourceInput]
load_evidence(evidence_ids: list[str], current_stage: int) -> list[EvidenceInput]
```

An Evidence item cannot be loaded before its configured stage.

## 6. Ingestion and source relationships

### 6.1 Ingestion identity

`(provider, source_id)` is the canonical acquisition identity.

- Re-ingesting the same identity returns the existing Signal.
- Re-ingestion does not repeat extraction or dispatch to B.
- The write API also follows the central `Idempotency-Key` rules.
- Reusing an idempotency key with a different request returns
  `409 idempotency_key_reused`.

### 6.2 Source relationship behavior

| Input | Signal behavior | Claim behavior |
|---|---|---|
| Same provider and source ID seen again | Return existing Signal | Do not re-extract |
| Pure repost | Create a new Signal linked to the original | Create no new Claim |
| Repost with added commentary | Create a linked new Signal | Extract only the added commentary when separately available in the dataset |
| Independent report | Create a new Signal | Extract its Claim units normally |
| Unrelated post | Create a new Signal | Extract normally; B decides its Case |

Identical or similar text from a different source ID is never deleted merely because
of text similarity. Pure reposts may contribute to activity counts, but they do not
increase independent evidence strength.

### 6.3 Event grouping boundary

A may persist `source_relation` and `duplicate_of_signal_id`. A must not assign an
event or Case based on semantic similarity. B uses those relationships, Claims and
entities to group Signals.

## 7. Claim extraction

### 7.1 Invocation

- At most one normal LLM call is made for each new, non-pure-repost source.
- No web, file-search or other external tools are available to the extraction call.
- The model receives the source text and source metadata needed for attribution.
- The model returns structured output validated with the shared Pydantic models.

### 7.2 Granularity

A Claim is the smallest independently verifiable or actionable statement unit, not
the smallest grammatical fragment.

Split a statement only when one of these differs:

- Claim kind.
- Required verification source.
- Brand, batch, region or time scope.
- Whether one proposition could be supported while another is refuted.
- Downstream handling path, such as external evidence versus internal platform data.

Do not split a brand, batch, publisher or modifier into separate Claims when they
jointly describe one proposition. A typical social post should yield zero to two
Claims. The hard maximum is six.

### 7.3 Extraction invariants

- `quote` must be an exact contiguous substring of `source.raw_text`.
- `normalized_statement` may clarify wording but must not add an entity, scope,
  cause, responsibility or outcome absent from the quote.
- Unknown region, batch and time scope remain explicit `null`.
- A Claim never receives facts inferred from another Signal.
- Empty or non-substantive content may yield an empty Claim list.
- `fact` means asserted as fact, not verified as true.

### 7.4 Initial verification state

- A checkable `fact` or `hypothesis` starts as `insufficient_evidence` with no Evidence.
- A pure request starts as `not_applicable`.
- An experience remains available to B as a market Signal. If it contains no separate
  externally checkable proposition, its verification status is `not_applicable`.
- A checkable proposition embedded in an experience may be extracted separately only
  when it needs a different verification source or verdict.

## 8. Verification

### 8.1 Trigger and service boundary

Verification is not automatically run for every extracted Claim. B decides whether
and when to call A:

```python
verify_claim(claim_id: str, evidence_ids: list[str], current_stage: int)
    -> ClaimVerificationResult
```

A loads the Claim and only the requested Evidence items available at the current
stage. The model input is the Claim plus those Evidence documents.

### 8.2 Allowed results

M1 follows the central verification enum:

- `supported`: the supplied Evidence directly supports the Claim.
- `refuted`: the supplied Evidence directly contradicts the Claim.
- `insufficient_evidence`: the Evidence is absent, irrelevant, indirect, incomplete,
  or materially conflicting without a single supported conclusion.
- `not_applicable`: the Claim is not suitable for evidence verification.

The central contract does not currently define `mixed`. M1 represents unresolved
mixed Evidence as `insufficient_evidence` and preserves the individual supporting
and refuting Evidence stances. Adding `mixed` requires a coordinated enum change led
by B.

### 8.3 Structured output

One bounded LLM call returns both the overall result and each supplied Evidence
stance:

```json
{
  "verification_status": "supported",
  "evidence_assessments": [
    {"evidence_id": "ev_001", "stance": "supports"}
  ]
}
```

Each input Evidence ID appears exactly once with one of
`supports | refutes | context_only`. A result of `supported` or `refuted` must cite at
least one corresponding Evidence item. Code rejects an unsupported combination
rather than repairing it into a stronger verdict.

### 8.4 External document behavior

M1 does not monitor official or news websites. D's committed pack introduces real
external FDA/CNA documents in later replay stages, while the replay itself remains
controlled. The same document may serve as:

- A newly ingested Signal that B attaches to the Case.
- Evidence cited when verifying an earlier Claim.

These roles reference the same underlying external-source document and do not count as
two independent sources.

## 9. Persistence and failure behavior

### 9.1 Persistence

A persists enough data to reconstruct the handoff and verification history:

- Source provenance and raw text.
- Signal relationship to an original Signal.
- Extracted Claims.
- Evidence provenance and excerpts.
- Verification attempts and results.
- Model attempt status and sanitized failure information.

Old verification results must not be silently overwritten. B is responsible for
reflecting meaningful updates as immutable Case revisions and timeline entries.

### 9.2 Retry threshold

Claim extraction and verification each allow two total model attempts: the initial
attempt plus one retry for invalid structured output or a retryable provider failure.

After both attempts fail:

- Preserve the original Signal, Claim and Evidence inputs.
- Record failure without inventing Claims or a verdict.
- Do not present the operation as successful.
- M1 does not schedule an automatic later retry.

No SQLite write transaction may remain open while awaiting an LLM or other external
API.

## 10. Handoff to B

### 10.1 New Signal

After A successfully persists and extracts a new Signal, the application reserves and
attempts this handoff:

```python
case_dispatcher.dispatch(signal_id)
```

B reads the canonical Signal and Claims from the shared repository. A does not send a
second simplified payload or require B to translate fields.

- A pure repost is dispatched because it is a new Signal, even though it has no new
  Claim.
- A repeated ingestion of an existing Signal is not dispatched again.
- A Signal whose extraction failed remains stored and is not dispatched as a normally
  analyzed Signal.
- B's dispatch must be idempotent for the same `signal_id`.
- A completed dispatch is not repeated. A failed dispatch is released to `pending` and
  may be retried without repeating extraction. Because an external failure can be
  ambiguous, this is one durable successful handoff, not a claim of transport-level
  exactly-once delivery.

### 10.2 Verification update

B knows the owning Case when it requests a Claim verification. After A persists the
result, B advances that Case using the updated Claim/Evidence references. A does not
decide how the Case priority or scope changes.

### 10.3 Parallel-development fixture

A supplies at least one canonical Signal fixture for each of these cases:

- Initial experience.
- Pure repost linked to an earlier Signal.
- Independent report.
- New checkable fact or hypothesis.
- Supported verification.
- Refuted or insufficient verification.

Every fixture must pass the shared Pydantic models in `app/schemas.py` without field
translation.

## 11. M1 acceptance criteria

### Dataset and ingestion

- Processing one stage returns only that stage's newly available inputs in stable order.
- Repeating ingestion for the same provider source creates no duplicate Signal, Claim
  or dispatch.
- A pure repost is retained as a Signal and linked to its original Signal.
- A similar independent report is retained and is not reclassified as a repost based
  solely on text similarity.

### Claim extraction

- A normal experience-only post produces one Experience Claim, not fabricated Fact,
  Hypothesis and Request Claims.
- A mixed post can produce separate Claim kinds when their handling differs.
- A compound statement using one evidence source and scope is not over-split.
- Every quote is traceable to the exact source text.
- Missing scope remains unknown rather than being copied from another post.

### Verification

- The verifier uses only the supplied committed Evidence.
- Supported and refuted results cite matching Evidence.
- Missing, irrelevant or unresolved conflicting Evidence produces
  `insufficient_evidence`.
- Experience and request content is preserved even when verification is not applicable.
- A failed verification remains visible and is never returned as a verdict.

### B integration

- B can parse A's fixture using the shared models.
- A completes one durable successful dispatch for each newly created Signal in replay
  order; B tolerates retries of the same `signal_id`.
- B can attach a pure repost to a Case without treating it as independent evidence.
- A verification update can be used by B without A making any priority or Case decision.

## 12. Intent traceability

This specification implements or supports these existing intent requirements; it
does not redefine their business meaning.

| M1 capability | Intent goals | Constraints | Success signals |
|---|---|---|---|
| Preserve source text, provenance and weak signals | INT-G1, INT-G3 | INT-C1, INT-C5 | INT-S1, INT-S11 |
| Retain reposts without treating them as independent evidence | INT-G3 | INT-C12 | INT-S2, INT-S12 |
| Extract source-grounded Claim units | INT-G1, INT-G4 | INT-C3, INT-C4, INT-C7 | INT-S3, INT-S4 |
| Compare Claims with traceable committed Evidence | INT-G4, INT-G7 | INT-C5, INT-C10 | INT-S3, INT-S9 |
| Hand new Signals and verification updates to B | INT-G6, INT-G7, INT-G8 | INT-C10, INT-C11 | INT-S8, INT-S10, INT-S12 |
| Controlled staged replay | INT-G8, INT-G9 | INT-C11, INT-C13 | INT-S10, INT-S13 |

The precise source, scenario and scheduling questions remain governed by INT-Q3,
INT-Q4, INT-Q7, INT-Q10 and INT-Q11. M1 answers only the controlled-data and
controlled-replay portion of those questions.

## 13. Frozen M1 integration decisions

1. A0 implements the existing central Signal, Claim and Evidence fields as the one
   shared Pydantic model set in `app/schemas.py`; this is translation to code, not a
   new schema design.
2. A1 adapts Morris's committed six-stage demo pack in `contracts/fixtures/demo/` and
   does not maintain a duplicate `app/demo_data` copy.
3. A hands every newly analyzed Signal to an injected async
   `dispatch(signal_id)` interface. B-side Case storage and HTTP transport choices do
   not change A's interface.
4. The A endpoint request and response bodies are fixed in Task A5.
5. Unresolved conflicting Evidence maps to `insufficient_evidence`; M1 does not add a
   `mixed` enum.

## 14. M2 extension points

M2 may replace the controlled loader with a Threads source adapter and a live evidence
retriever. Those adapters must map into the same canonical Signal and Evidence models.
M1 does not pre-implement provider-specific pagination, monitoring or search behavior.
