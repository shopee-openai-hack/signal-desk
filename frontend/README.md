# Signal Desk 前端與可互動 mock

這個目錄包含四個前端入口與一個獨立的本機 HTTP mock service。mock 使用與
[`contracts/README.md`](../contracts/README.md) 相同的 `/api/v1` 路徑和 snake_case
資料語意；前端元件只透過相對 URL 呼叫 API，不直接 import fixture。

## 本機啟動

先安裝依賴：

```sh
npm ci
```

需要 mock 時開兩個 terminal：

```sh
# Terminal A
npm run mock

# Terminal B
npm run dev:mock -- --strictPort
```

開啟 <http://localhost:5173>。Vite 的 `mock` mode 將 `/api` 和 `/healthz`
proxy 到 `http://localhost:4100`。mock state 預設保存到系統暫存目錄
`/tmp/shopee-openai-hack-mock-state.json`，所以重新整理或重啟 mock service 後仍會
保留核可、執行與商品狀態。要指定路徑或清掉資料，可執行：

```sh
MOCK_STATE_PATH=/tmp/my-signal-desk.json npm run mock
curl -X POST http://localhost:4100/api/v1/mock/reset
```

若要接目前 FastAPI starter，使用原本的 `npm run dev`；它會把相同相對 API
proxy 到 `http://localhost:8000`。目前 FastAPI 尚未提供案件工作流 endpoints，
因此四頁的完整互動應以 `dev:mock` 驗證。

## 頁面與互動

- **案件列表** `/cases`：比較業務影響、優先級、案件版本、專員可觀測狀態和下次追蹤。
- **訊號收件匣** `/inbox`：閱讀原文、來源、轉傳／獨立回報關係與查核狀態。
- **案件詳情** `/cases/:case_id/overview`：概覽、陳述、證據、未知事項、下一步與專員狀態。
- **相關商品** `/cases/:case_id/products`：選取候選模擬商品，先核可，再明確執行；已核可商品若案件版本改變會被阻擋。
- **案件時間軸** `/cases/:case_id/timeline`：查看不可覆寫的案件事件、版本、理由與來源。
- **Trace 回放** `/trace`：播放保存的跨角色步驟，可暫停、前後跳步與跳回；人工核可步驟會暫停，播放不會觸發寫入。

mock 內建兩個 trace：食用油主線，以及第一次失敗、第二次以相同 execution record
重試成功的例外主線。`prod_oil_002` 會在第一次執行時失敗，重試會更新同一筆
execution 的 `attempts`，不會製造第二筆成功操作。

## Mock API 差異與整合缺口

以下 endpoints 對齊中央契約，可供後端完成後直接替換：

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/v1/cases` | 案件列表 |
| GET | `/api/v1/cases/{case_id}` | 案件 snapshot |
| GET | `/api/v1/cases/{case_id}/timeline` | 案件 immutable timeline |
| GET | `/api/v1/products` | 模擬商品 |
| POST | `/api/v1/cases/{case_id}/approvals` | 以案件版本建立人工核可 |
| POST | `/api/v1/approvals/{approval_id}/execute` | 執行核可的模擬下架 |
| POST | `/api/v1/cases/{case_id}/advance` | 新證據造成版本變更（契約列出的 provisional B endpoint） |

下列 endpoints 是為了前端在後端並行期間可展示而加入的 **mock-only provisional
read model**，不能視為中央契約已完成：

- `GET /api/v1/signals`：收件匣 read model；中央契約目前只有 ingest POST。
- `GET /api/v1/cases/{case_id}/agent-status`：已保存的專員觀測；不是常駐 agent 或即時執行證明。
- `GET /api/v1/cases/{case_id}/approvals`：前端 reload 後讀取保存核可與 execution 結果。
- `GET /api/v1/traces`、`GET /api/v1/traces/{trace_id}`：保存 trace snapshot，只讀播放。
- `POST /api/v1/mock/reset`：清除並重建 mock state，供展示和測試使用。

所有寫入（reset 除外）要求 `Idempotency-Key`；重複 key 會 replay 同一 response。
案件版本不符回傳 `409 version_conflict`，錯誤格式維持中央契約的
`{"error":{"code":"...","message":"...","details":{}}}`。

## 驗證

```sh
npm run test:mock
npm run typecheck
npm run build
```

mock HTTP 測試涵蓋讀取、持久化與重啟、核可／執行 idempotency、案件版本衝突、
失敗可見與同一 execution retry。瀏覽器 UI／實際 FastAPI 整合仍需由整合負責人
另行驗證；本 mock 成功不代表雲端部署或真實平台操作完成。
