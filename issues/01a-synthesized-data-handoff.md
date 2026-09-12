# A ↔ D — M1 controlled demo data handoff

Status: Integrated
Last updated: 2026-09-12

This issue records the cross-team handoff only. It is not another contract or scenario
specification:

- Product scope: `INTENT.md`
- Shared Signal/Claim/Evidence fields: `contracts/README.md`
- A behavior: `SPEC.md`
- D scenario meaning: `docs/demo/demo-pack.md`
- Machine-readable inputs: `contracts/fixtures/demo/signals.json` and `evidence.json`

## Frozen boundary

- Source acquisition is deterministic and makes no LLM or Threads API call.
- Stages 1–3 are simulated Threads posts. Stages 4–6 retain the committed FDA/CNA
  provenance. A does not fetch those websites at runtime.
- A performs bounded Claim extraction for each new non-repost Signal.
- A preserves pure reposts as Signals but extracts no duplicate Claims from them.
- B owns event grouping, Case routing, priority and recheck timing.
- A hands B `signal_id`; B reads the canonical Signal and Claims from the shared store.
- M2 may replace the fixture loader with live source and Evidence adapters.

## Adapter rules

D's source fixture is flat, while A's runtime ingest envelope contains a nested
`source`. The loader performs only these deterministic transformations:

1. Select exactly the requested replay stage.
2. Set missing source `retrieved_at` equal to `published_at`.
3. Validate UTC timestamps, unique provider/source identity and repost references.
4. Derive an Evidence stage by uniquely matching its URL to a Stage 4–6 source.
5. Remove D's golden `claim_id` and `stance` before constructing runtime
   `EvidenceInput`.

D's golden fields are evaluation labels, not model inputs. Source grounding wins if a
golden target is not stated in the source. The Stage 6 acceptance path may therefore
be `insufficient_evidence`; A must not invent the unstated Claim that all expanded
batches remain affected.

## Verification contract

The verifier receives one canonical Claim and only the explicitly selected Evidence.
It returns the existing shared enum:

- `supported`
- `refuted`
- `insufficient_evidence`
- `not_applicable`

Each supplied Evidence item also receives `supports`, `refutes`, or `context_only`.
Unresolved conflicting Evidence maps to `insufficient_evidence`; M1 does not add a
`mixed` enum. Extraction and verification each allow an initial model attempt plus one
retry. No SQLite write transaction remains open while awaiting a model or dispatcher.

## Handoff result

The six-stage pack is integrated. Deterministic loader, canonical fixtures and the
full A acceptance test cover initial weak signal, repost, independent report, official
support, expanded scope and a later insufficient/refuting path. No additional D or
user approval is required for A/M1 implementation.
