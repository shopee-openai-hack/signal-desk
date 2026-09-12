# Signal Desk：FastAPI 受控 Demo

四個頁面（訊號收件匣、案件列表、案件詳情與 Trace）都透過相對 `/api/v1/demo/*` HTTP requests 讀取同一個 FastAPI 後端。商品核可與模擬執行由後端寫入 SQLite；重新整理或重啟後端仍會保留操作結果。前端不再連接獨立 Node mock service。

## 啟動

在 repo 根目錄啟動後端，再於另一個 terminal 啟動前端：

```sh
.venv/bin/uv run uvicorn app.main:app --reload --env-file .env --port 8000
cd frontend && npm ci && npm run dev -- --strictPort
```

開啟 <http://localhost:5173>。Vite 把 `/api` 代理到 `localhost:8000`；部署時 FastAPI 直接提供同一組端點與前端靜態檔。受控回放預設停在 Stage 3，使用 `DATABASE_PATH` 指向的 SQLite 檔案保存狀態。使用另一個 `DATABASE_PATH` 可建立獨立的乾淨 demo 資料庫。
根目錄 `.env` 的 `PUBLIC_ORIGIN` 必須與瀏覽器網址一致（預設 `http://localhost:5173`），否則後端會拒絕修改請求。若需要換後端 port，可設定前端啟動環境變數 `VITE_API_TARGET=http://localhost:<port>`。

## 後端端點

| Method | Path | 前端用途 |
| --- | --- | --- |
| GET | `/api/v1/demo/status` | 目前 Stage、來源與已保存的核可／執行數 |
| POST | `/api/v1/demo/reset` | 明確重置至 Stage 0 或 3；已有操作紀錄時需 `confirm: true` |
| POST | `/api/v1/demo/advance` | 以 `expected_stage` 揭露下一段；Stage 4 的三筆商品必須先核可並執行 |
| GET | `/api/v1/demo/signals` | 來源、陳述、證據與案件關聯 |
| GET | `/api/v1/demo/cases`、`/cases/{case_id}` | 案件列表與詳情 |
| GET | `/api/v1/demo/cases/{case_id}/timeline` | 不可覆寫的事件時間軸 |
| GET | `/api/v1/demo/cases/{case_id}/agent-status` | 已保存的專員觀測，不代表現在有模型正在執行 |
| GET | `/api/v1/demo/products` | 九筆模擬商品與目前上架狀態 |
| GET/POST | `/api/v1/demo/cases/{case_id}/approvals` | 讀取或建立人工核可，連同逐項 execution 結果 |
| POST | `/api/v1/demo/approvals/{approval_id}/execute` | 明確執行模擬下架；失敗可用新 idempotency key 重試同一 execution |
| GET | `/api/v1/demo/traces`、`/traces/{trace_id}` | 六段主線與失敗重試的唯讀保存 Trace |

所有 mutation（reset 除外）使用 `Idempotency-Key`。版本／Stage 衝突會回 `409`，錯誤格式為 `{"error":{"code":"...","message":"...","details":{}}}`。Stage 是回放游標，案件版本是判讀修訂；Stage 2 純轉傳只增加訊號和 `signal_added` 時間軸，案件仍為 v1，Stage 3–6 為 v2–v5。

## 操作路徑

1. 在案件頁從 Stage 3 進到 Stage 4。三筆 `confirmed`（`prod_001`、`prod_003`、`prod_005`）仍為 `active`；`prod_002` 批號未知，不可核可。
2. 在商品頁勾選三筆，建立核可，再點明確執行。重新整理後商品、核可與逐項結果仍可見。未完成此步會被後端阻擋進入 Stage 5。
3. 進入 Stage 5，`prod_007`、`prod_009` 為新候選，不繼承舊核可。Stage 6 只排除 `prod_009`，不自動恢復既有下架商品。
4. Trace 頁展示保存的 phases／activities、證據引用、前後快照與重試歷史；播放不觸發上述 mutation。
5. 可在任一頁重置 Stage 3 或從 Stage 0 逐段回放；Stage 0 的案件列表為空，頂部仍有「下一 Stage」控制。

這是**由 FastAPI 保存與提供的受控案例回放**，資料快照來自 `contracts/fixtures/demo/backend_replay.json`，不是執行中的 OpenAI 判讀。正常 A+B ingest／verify／Case API 保留在 `/api/v1`，與 demo namespace 的 SQLite 狀態分開；真實訊號尚不會自動變成受控回放的一段。Trace 也是保存的合成紀錄，不是現場 agent telemetry。外部公告及新聞仍需 demo 前逐字核對，商品均為模擬 listing。

原 Node mock 檔案只作歷史 fixture 與回歸測試，不參與前端執行。驗證命令：

```sh
.venv/bin/uv run pytest -q
cd frontend && npm run typecheck && npm run build && npm run test:mock
```
