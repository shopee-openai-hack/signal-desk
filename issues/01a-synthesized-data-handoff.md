# A ↔ D — M1 controlled data handoff

Status: Approved M1 handoff baseline

Owner: Morris Chen

Last updated: 2026-09-12

本文件記錄 A（source ingestion and verification）如何消費 D（business demo data）已核定的資料。產品範圍以 `INTENT.md` 為準，共用 API／資料模型以 `contracts/README.md` 為準，六段情境與商業語意以 `docs/demo/demo-pack.md` 為準。

## 唯一資料來源

A 不建立 `app/demo_data/` 或第二套 M1 fixture，直接讀取：

- `contracts/fixtures/demo/signals.json`：六段 source ingestion 輸入。
- `contracts/fixtures/demo/evidence.json`：Stage 4–6 的查核證據。
- `contracts/fixtures/demo/products.json`：B/C 使用的九筆模擬商品；A 只需確認 ID 可追溯。
- `contracts/fixtures/demo/expected_case_states.json`：B/C 的六段 evaluation examples；A 不把商業判斷寫死在 verifier。

這組 controlled dataset 混合兩類資料：Threads 貼文是明確的模擬輸入；食藥署公告與中央社報導是回放用的外部來源摘錄。M1 不在回放時連網抓取。公告標題、日期、數字與摘錄在 demo 前仍要由 A 逐字核對，最後交 Morris 簽核。

## 已確認的 M1 邊界

- Source acquisition 不呼叫 LLM，也不連接 Threads API。
- 每篇新 source 最多執行一次 claim-extraction LLM call；格式不合法時最多再 retry 一次。
- Event grouping、case routing、priority、商品關聯與是否重新查核由 B 負責。
- A 每建立一個新 Signal，就以 `signal_id` 逐筆交給 B；B 從共用 store 讀取完整資料。
- Pure repost 保留為獨立 Signal，但不當作獨立佐證，也不產生重複 Claim。
- M2 才考慮 Threads API、即時監控、pagination 與 live evidence retrieval。

## 六段回放

| Stage | 輸入 | A 應保留的語意 |
|---|---|---|
| 1 | 泰山沙拉油的二手收回說法、個人異味經驗與詢問 | 分開保留 hypothesis／experience／request；證據不足 |
| 2 | `post_001` 的 pure repost | 建立新 Signal、連回原文，不新增獨立佐證或重複 Claim |
| 3 | 不同作者帶入福壽、中聯與批號 `315-1150404` | 視為獨立回報並保留可查核陳述 |
| 4 | 食藥署首波公告 | 支持 `clm_s3_fact_zhonglian` 對應的 runtime Claim |
| 5 | 食藥署擴大下架公告 | 支持 `clm_s5_scope_expansion` 對應的 runtime Claim |
| 6 | 中央社逐批檢驗結案報導 | 反駁「擴大列管的所有批次都仍有問題」；不可推成全部安全 |

Stage 6 的外部證據沒有直接提到模擬批號 `315-1150411`。該批號是 D 回放中映射到合格批次的代表；A 必須保留這項區別，不可宣稱新聞直接證實該 listing 或批號。

## Loader 與 ID 規則

- `signals.json` 的 item 是核定的 flat shape。A 不要求 D 改成巢狀 `source` envelope。
- Stage 內依 `(published_at, source_id)` 穩定排序。
- fixture 不含 source `retrieved_at`。Ingestion 由 injected clock 寫入；測試使用 frozen clock，正式執行記錄實際取得時間。
- Evidence 可用 stage 由 Evidence URL 對應到 `signals.json` 中唯一相同 URL 的 source item 推導。缺少或多重對應都視為 fixture validation error。
- D fixture 的 Evidence `claim_id` 與 `stance` 是 evaluation expectation。A 仍產生 canonical runtime `signal_id`／`claim_id`，再以來源與陳述語意完成 binding；找不到唯一對應時 replay 必須失敗並留下錯誤，不可虛構 Claim。

## Verification contract

Verifier 只能依呼叫時提供的 Evidence 判斷，不能用未提供的背景知識補足。輸出沿用中央 contract：

- `supported`：資料直接支持 Claim，並至少引用一筆 `supports` Evidence。
- `refuted`：資料直接反駁 Claim，並至少引用一筆 `refutes` Evidence。
- `insufficient_evidence`：沒有資料、資料不直接相關、資訊不足，或正反資料並存且無法形成單一結論。
- `not_applicable`：純 request 或不含可外部查核命題的 experience。

中央 contract 沒有 `mixed`。每筆輸入 Evidence 仍需保存 `supports | refutes | context_only` stance；驗證失敗不能被轉成成功 verdict。

## A 的處理流程

```text
D fixture stage
→ A deterministic loader
→ persist Signal with replay-clock retrieved_at
→ LLM claim extraction
→ validate contract and exact source quote
→ bind scenario expectations where applicable
→ hand signal_id to B

B requests verification for claim_id
→ A loads only Evidence available at current stage
→ one structured-output LLM call
→ persist verification result and Evidence links
→ B advances the owning Case
```

Claim extraction 與 verification 各最多兩次 model attempts。第二次仍失敗時保留輸入與失敗狀態，不產生推測結果；model call 前後不可持有 SQLite write transaction。

## 驗收清單

- 六個 stage 都能依序載入，Stage N 不重送舊 source。
- Repost 明確指向 `post_001`；Stage 3 保持 independent report。
- Source、Evidence 時間皆為 UTC，Evidence URL 都能唯一對應到 Stage 4、5 或 6。
- Stage 1 不把個人經驗升格成食安事實。
- Stage 4 支持、Stage 5 擴大、Stage 6 部分反駁三條路徑都可重現。
- Runtime Claim binding 無法唯一完成時明確失敗。
- 外部來源摘錄保留「demo 前需逐字核對」標示。
