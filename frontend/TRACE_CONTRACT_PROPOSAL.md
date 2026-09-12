# Trace read model proposal

Status: frontend proposal for the central contract owner. The mock producer implements the additive shape; the extracted `TracePage`
consumer still uses legacy `steps` and does not yet render `phases`; `contracts/README.md`
remains authoritative until the proposal is accepted there.

## Purpose and boundaries

Trace is a saved, immutable replay of one workflow. It explains business
events, observable agent activities, evidence references, and case changes. It
does not expose prompts, private chain of thought, credentials, or provider
responses that are not safe for the reviewer.

The current producer is `frontend/mock/server.mjs`. It labels every fixture
`mode: "saved_mock"`, and its replay metadata sets `read_only: true`. The
consumer is `frontend/src/pages/TracePage.tsx`; it currently owns legacy step playback. Rich phase/activity playback, speed,
and the revealed boundary remain to be implemented. Reading or playing a
trace never calls a write endpoint, creates approval or execution records, or
calls a paid provider.

## Endpoints

| Method | Path | Response | Side effects |
| --- | --- | --- | --- |
| `GET` | `/api/v1/traces` | `{items: TraceSummary[], next_cursor: string|null}` | None; compact list omits `steps` and `phases` |
| `GET` | `/api/v1/traces/{trace_id}` | `Trace` | None; immutable saved snapshot |

The endpoints use the existing relative `/api/v1` prefix, opaque IDs, snake
case, and UTC ISO 8601 timestamps. A missing trace uses the normal
`not_found` error envelope. No `POST` replay endpoint is required. A future
live-run endpoint must be a separate contract and must not be inferred from
this saved read model.

## Shape

The existing `steps` array remains on `Trace` for compatibility with the first
frontend and can be omitted by a future consumer only after a coordinated
contract change. `phases` is the richer additive field.

```json
{
  "trace_id": "trace_oil_main",
  "name": "食用油安全疑慮｜完整主線",
  "description": "從弱訊號到人工確認候選商品的保存紀錄。",
  "mode": "saved_mock",
  "scenario": "main",
  "case_id": "case_oil_safety",
  "trace_status": "saved",
  "recorded_at": "2026-09-12T02:20:00.000Z",
  "phase_count": 5,
  "activity_count": 9,
  "contains_human_pause": true,
  "replay": {
    "strategy": "ordered_phases",
    "default_speed": 1,
    "speed_options": [0.5, 1, 1.5, 2],
    "pause_on_human": true,
    "read_only": true,
    "cursor_semantics": "client_revealed"
  },
  "phases": [
    {
      "phase_id": "main.phase.verify",
      "sequence": 3,
      "kind": "verification",
      "title": "查核來源與更新案件判讀",
      "summary": "辨識重複轉傳，查詢官方公告，保留批次未知。",
      "reason": "轉傳沒有新增獨立事實；目前查詢也沒有形成批次確認。",
      "actor": {"type": "case_agent", "id": "agent_food_safety"},
      "status": "completed",
      "occurred_at": "2026-09-12T02:12:00.000Z",
      "started_at": "2026-09-12T02:06:00.000Z",
      "completed_at": "2026-09-12T02:12:30.000Z",
      "progress": {"completed_activities": 3, "total_activities": 3},
      "input": [
        {"key": "signal_id", "label": "新增訊號", "value": "sig_oil_002", "ref": "sig_oil_002"}
      ],
      "output": [
        {"key": "verification_status", "label": "查核結果", "value": "insufficient_evidence"}
      ],
      "source_refs": ["sig_oil_001", "sig_oil_002", "evidence_oil_001"],
      "evidence": [
        {
          "evidence_id": "evidence_oil_001",
          "label": "目前沒有對應批次的官方公告",
          "url": "https://example.test/evidence/official-check",
          "excerpt": "查詢結果尚未找到可對應品牌與批次的公告。",
          "stance": "context_only"
        }
      ],
      "activities": [
        {
          "activity_id": "main.verify.search-official",
          "sequence": 2,
          "kind": "search",
          "title": "搜尋官方公告",
          "summary": "查詢結果未找到可對應品牌與批次的公告。",
          "reason": "官方來源可支持或反駁原始回報，但目前沒有可匹配批次。",
          "actor": {"type": "case_agent", "id": "agent_food_safety"},
          "status": "completed",
          "occurred_at": "2026-09-12T02:10:00.000Z",
          "started_at": "2026-09-12T02:10:00.000Z",
          "completed_at": "2026-09-12T02:10:00.000Z",
          "input": [
            {"key": "query", "label": "查詢條件", "value": "金橘食品 批次 官方公告"}
          ],
          "output": [
            {"key": "result_count", "label": "結果數", "value": 0},
            {"key": "verification_status", "label": "查核狀態", "value": "insufficient_evidence"}
          ],
          "source_refs": ["evidence_oil_001"],
          "evidence": [
            {
              "evidence_id": "evidence_oil_001",
              "label": "目前沒有對應批次的官方公告",
              "url": "https://example.test/evidence/official-check",
              "excerpt": "查詢結果尚未找到可對應品牌與批次的公告。",
              "stance": "context_only"
            }
          ],
          "retry_of_activity_id": null,
          "attempt": 1,
          "error": null
        }
      ],
      "case_before": {
        "case_id": "case_oil_safety",
        "title": "食用油安全疑慮：品牌與批次待查",
        "version": 1,
        "status": "investigating",
        "business_impact": "risk",
        "priority": "high",
        "owner": {"type": "case_agent", "id": "agent_food_safety"},
        "claim_ids": ["clm_oil_001", "clm_oil_002"],
        "claims": [
          {
            "claim_id": "clm_oil_001",
            "verification_status": "insufficient_evidence",
            "statement": "有人回報金橘食品食用油可能有異味",
            "evidence_refs": []
          }
        ],
        "candidate_products": [],
        "unknowns": ["受影響批次尚未確認"],
        "next_steps": ["查找獨立來源與官方公告"]
      },
      "case_after": {
        "case_id": "case_oil_safety",
        "title": "食用油安全疑慮：品牌與批次待查",
        "version": 3,
        "status": "awaiting_approval",
        "business_impact": "risk",
        "priority": "high",
        "owner": {"type": "case_agent", "id": "agent_food_safety"},
        "claim_ids": ["clm_oil_001", "clm_oil_002"],
        "claims": [
          {
            "claim_id": "clm_oil_001",
            "verification_status": "insufficient_evidence",
            "statement": "有人回報金橘食品食用油可能有異味",
            "evidence_refs": []
          },
          {
            "claim_id": "clm_oil_002",
            "verification_status": "supported",
            "statement": "原始回報尚未形成官方確認",
            "evidence_refs": ["evidence_oil_001"]
          }
        ],
        "candidate_products": [
          {
            "product_id": "prod_oil_001",
            "relation": "candidate",
            "reason": "品牌名稱相符；批次未知",
            "missing_information": ["batch"],
            "product_status": "active"
          }
        ],
        "unknowns": ["受影響批次尚未確認", "官方公告的適用範圍仍需比對"],
        "next_steps": ["確認員工要處理的模擬商品", "持續追蹤官方食安公告"]
      },
      "next_activity": null,
      "next_phase": {"id": "main.phase.approval", "title": "等待人工核可", "sequence": 4},
      "pause_reason": null
    }
  ],
  "steps": []
}
```

All fields in the example are public summaries. A value of `null` means the
producer does not know or the activity has not happened; the consumer must not
infer a value from the current case snapshot.

## Status and replay semantics

- `trace_status: "saved"` means the record is a completed synthetic or backend
  snapshot available for replay. It does not mean a current workflow is
  running.
- Phase status `completed` and `succeeded` are past recorded work. `failed`
  keeps the error and the failed snapshot. `waiting_human` is a recorded pause
  point. `ready` is work recorded as ready but not yet executed. Whether a stage has
  been revealed to the viewer is separate client playback state.
- Activity `retry_of_activity_id` points to the stable failed activity ID and
  `attempt` starts at 1. A retry appends a new activity and does not erase the
  failed attempt.
- `next_activity` and `next_phase` are producer-recorded suggested next
  actions. They are not the viewer's cursor. The consumer derives its own
  `revealed_sequence`, `playing`, and `speed` locally from ordered phases.
- `pause_on_human: true` tells the consumer to stop at a `waiting_human` phase.
  Continue and step controls reveal the saved next phase only; they never
  submit the human action.
- A phase's `case_before` and `case_after` are immutable snapshots with status,
  business impact, priority, claim verification, candidate relation/reason,
  missing information, and unknowns. They explain what changed without
  exposing private reasoning.

## Producer and consumer mapping

FastAPI serves saved phases and activities under `/api/v1/demo/traces`, and
TracePage renders them as a vertical timeline with expandable details. The
records originated as synthetic fixture data; a live A/B/C Trace producer is
still outstanding.

| Contract field | Mock producer | Trace consumer |
| --- | --- | --- |
| `mode`, `trace_status`, `scenario` | Synthetic labels in `server.mjs` | Badge and scenario picker |
| `phases`, `sequence`, `progress` | Ordered saved phases | Vertical chronological timeline |
| `activities` | Search/read/tool/handoff/retry/wait records | Expandable stage details |
| `input`, `output`, `source_refs`, `evidence` | Scalar fields and safe references | Input/output and evidence panels |
| `case_before`, `case_after` | Versioned business snapshots | Before/after comparison |
| `next_activity`, `next_phase` | Recorded suggested next action | Contextual next-action hint |
| `replay` | Read-only playback policy | Play/pause/speed and human pause |
| legacy `steps` | Existing six/two step fixtures | Compatibility fallback during rollout |

The mock state migration now reaches schema version 3. It enriches existing
trace objects and corrects Stage 2 repost/version semantics, translating later
Case and approval versions while preserving approvals, executions, products,
and timeline history. It clears cached mutation responses with old versions.
The central backend should use its own migration if persisted demo data exists.

## Scenarios covered by the mock

- `main`: intake → dispatch → verification → human approval pause → ready
  execution. It demonstrates repeated sources, insufficient evidence, and
  candidate products that remain distinct from confirmed impact.
- `failure_retry`: saved approval context → first execution failure → retry of
  the same execution. It demonstrates a preserved error, stable retry link,
  attempt count, and a final delisted snapshot without a duplicate execution.
