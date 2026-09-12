# Frontend sync — 2026-09-12

## Current integration checkpoint

The notes below record C's earlier handoff and include historical branch and
test status. The current `main` contains A+B's FastAPI ingest, verify, Case,
timeline, inbox and saved agent-status endpoints together with C's four-page
UI and rich vertical Trace reader. The full six-stage presentation still runs
through the separate Node mock; FastAPI has no product approval/execution,
saved Trace producer or replay controller yet. The mock now treats Stage 2 as
a pure repost (`signal_added`, Case v1 unchanged); Stages 3–6 use Case v2–v5.
The UI exposes the reason-only replay action only in mock mode and uses
`demo_stage` for Stage 4 product eligibility. A stale approval blocks its own
execution but does not block creating a fresh approval for Stage 5 products.

## 可用基準

- Branch：`frontend`；基準 commit：`e9903e2`（四頁、HTTP mock 與前端文件）。本次收尾將連同後續修改推送 `origin/frontend`；未部署。
- 頁面：訊號收件匣、案件列表、案件詳情（概覽／商品／時間軸）、Trace 回放。固定左側導覽；案件列表為首頁。
- 啟動：在 frontend 執行 `npm run mock`，另一個 terminal 執行 `npm run dev:mock -- --strictPort`；開啟 http://localhost:5173。
- Mock 使用相對 `/api/v1` HTTP requests，支援商品選取 → 核可 → 明確執行、狀態持久化、版本衝突、失敗與重試。
- Maker 證據：4/4 mock HTTP tests、typecheck、build、diff check 通過；瀏覽器測過核可／執行與重整保留。
- Lead 獨立 HTTP probes 通過：Trace reads 不改商品、核可不執行、只下架選定商品、不同 key 重複執行不產生重複操作事件。已開啟並檢視案件列表與 Trace。
- 以上只證明本機 mock；真實 FastAPI 整合、完整新增 Trace 行為、雲端部署均未驗收。

## 已確認方向

- 使用 shadcn 預設元件與樣式；`DESIGN.md` 暫緩且不具目前實作權威。早先 standalone HTML 視覺樣張被否決，不得當作樣式參考。
- 案件詳情先做一次有限精修，保留資料流與操作；未授權自動套用全站或無止境重設計。
- Trace 改為垂直時間軸：保留已播放階段，展開 Agent 可觀測活動，逐層查看輸入、工具操作、產出、來源、失敗與重試及案件前後差異。
- 回放以保存紀錄為主；支援逐活動／逐階段閱讀，人工核可點暫停。不是現場執行，也不展示模型私有推理。
- Agent 執行狀態與案件狀態分開，未知狀態不得虛構為運行中。

## 本次 sync 要與後端對齊

| 需求 | 目前 mock 介面 | 後端待確認 |
| --- | --- | --- |
| 收件匣查詢 | `GET /api/v1/signals` | A 提供來源、完整陳述與證據；B 對齊案件關聯與查詢形狀 |
| 專員狀態 | `GET /api/v1/cases/{case_id}/agent-status` | 可觀測狀態、目前工作、等待原因、最近結果、下一步與觀測時間 |
| 保存 Trace | `GET /api/v1/traces`、`GET /api/v1/traces/{trace_id}` | 執行與階段／子活動關係、不可變前後快照、證據連結與重試歷史 |
| 核可結果讀取 | `GET /api/v1/cases/{case_id}/approvals` | 核可加逐項 execution，讓重新整理後能恢復操作狀態 |

上述能力已獲使用者確認；endpoint 與欄位是 mock 暫定形狀，尚未得到 B 的中央合約確認。不要把「暫定」解讀為功能未獲授權，也不要把 mock 視為後端已支援。

Trace 的合約方向是保留既有 `steps`，新增 richer phases／activities、時間、角色、輸入輸出與引用、失敗／重試、查核及商品關聯快照。播放游標由 UI 管理，不與紀錄中的下一步建議混用。精確欄位以後續凍結提案為準。

## 收尾中的工作

- `case_ui_refine`：已提交案件詳情精修；App.tsx、ui/table.tsx、ui/tabs.tsx。統一標題、翻譯內部值、整理證據與時間軸、商品改表格；typecheck/build/diff check 與 maker 瀏覽器檢查通過。Lead 已開啟新版概覽；完整功能回歸尚未另驗，精修納入本次收尾提交。新版預覽 http://localhost:5174/cases/case_oil_safety/overview；5173 的既有 dev service 需重啟才反映最新內容。
- Trace 原頁面已原樣抽到 `frontend/src/pages/TracePage.tsx`，可交給 Trace maker 獨立修改；不是新版垂直時間軸已完成。
- `trace_mock`：已提交 types、mock/server、6 項測試與 TRACE_CONTRACT_PROPOSAL.md。新增 phases／activities、快照與 retry；v1→v2 保留商品／核可／執行狀態。Maker 回報 6/6 mock tests、typecheck/build/diff check 通過。納入本次收尾提交；垂直 Trace UI 尚未實作，目前仍顯示 legacy steps。新 mock service 也需重新載入才能提供 phases。
- Lead：中央 contracts/README.md 已新增「待 B review」交接入口，既有 canonical API 保持不變；不直接更改後端 Pydantic 模型、不代替 B 宣稱合約已接受。已修正 Trace 提案中把 planned consumer 寫成已實作的文字。

## 收尾驗證

提交前 Lead 已重新執行 `npm run test:mock`（6/6）、`npm run typecheck`、`npm run build` 與 `git diff --check`，全部通過。垂直 Trace UI 與真實後端整合仍不在已完成項目。

## 下一段接續

先檢查 shared_status 與 git diff，確認兩位 maker 的最新提交及檔案 ownership。讀本文件、frontend/INTENT.md、frontend/README.md 與存在時的 TRACE_CONTRACT_PROPOSAL.md。完成案件詳情比較與垂直 Trace 的獨立驗收後，再將四項 read-model 提案與 fixture 納入中央合約供 B 對齊；不得默默改現有欄位語意。保持 frontend branch，保留原有 SPEC.md、outputs 與其他未追蹤檔案。後續新 subagent 可依使用者授權採 Astra／low effort；不要為切模型重啟進行中工作。
