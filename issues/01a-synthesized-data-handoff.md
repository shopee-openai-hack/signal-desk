# A ↔ D — M1 controlled demo data handoff

Status: Approved M1 handoff baseline
Last updated: 2026-09-12

本文件記錄 A（source ingestion and verification）與 D（business demo data）在
M1 的資料交接方式。產品範圍仍以 `INTENT.md` 為準，共用 API／資料模型仍以
`contracts/README.md` 為準；本文件不建立另一套 Signal、Claim 或 Evidence contract。

## 已確認的 M1 邊界

- 訊號與查核證據都使用 D committed 的 controlled dataset；Stage 1–3 是模擬 Threads
  貼文，Stage 4–6 保留真實 FDA/CNA 外部來源 provenance。
- Source acquisition 不呼叫 LLM，也不連接 Threads API。
- 每篇新貼文最多執行一次 claim-extraction LLM call；格式不合法時最多再 retry 一次。
- Event grouping、case routing、priority 與是否重新查核由 B 負責。
- A 每建立一個新 Signal，就以 `signal_id` 逐筆交給 B；B 從共用 store 讀取完整資料。
- Pure repost 保留為獨立 Signal，但不當作獨立佐證，也不產生重複 claim。
- M2 才考慮 Threads API、即時監控、pagination 與 live evidence retrieval。

## 名詞

### Claim

Claim 是從一篇市場貼文抽出的「可獨立理解或處理的陳述單位」。沿用中央 contract
的 `signal_kind`：`fact | experience | hypothesis | request`。

`experience` 是 Claim 的一種類型，不是 Claim 之外的資料。若貼文只說「我買的油
有怪味」，A 仍需抽出一個 `experience` Claim，否則 B 只會收到原文，沒有可用來
路由或累積案件脈絡的語意。Experience 可作為弱訊號或獨立回報，但本身不等於
事件已被證實。

### Evidence

Evidence 是用來評估某一 Claim 的另一份資料，例如公告、檢驗結果或新聞來源。
Verifier 的輸入必須同時包含 Claim 與當下可用的 committed Evidence；LLM 只能
依這些 Evidence 判斷，不得使用未提供的背景知識補足證據。

例如：

```text
Claim：中聯油脂批號 315-1150404 大豆油驗出苯駢芘超標
Evidence：Stage 4 食藥署公告，明確列出該供應商、批號與檢驗結果
Result：supported
```

## M1 scenario 資料責任

D 負責確認 scenario 的 stage 與商業語意，並已將六階段 committed
deterministic dataset 放在 `contracts/fixtures/demo/`；A1 負責轉換成 runtime
Signal/Evidence input，包括：

1. 每個 demo stage 出現的 replay sources。
2. 每篇 post 的原文、來源、發布時間與 repost relationship。
3. 後續 stage 出現的 committed Evidence documents。
4. 每份 evidence 可支持、反駁或無法決定哪些 scenario statement。
5. 每個 stage 預期改變或保持不變的商業判斷；這些是 acceptance expectation，
   不是 hard-coded model output。

D 不需要產生 runtime `signal_id` 或 `claim_id`；這些由 A 產生。

D owner 已確認並上傳此設計。`docs/demo/demo-pack.md` 是六階段商業語意
authority；`contracts/fixtures/demo/signals.json` 與 `evidence.json` 是 A 的機器可讀
input。Evidence 內 D 提供的 `claim_id` 與 `stance` 只供 evaluation，runtime verifier
input 會排除它們。

## 已確認的 demo stages

| Stage | Controlled input | 目的 |
|---|---|---|
| 1 | 一篇初始個人食用油異常回報 | 建立 `experience` Claim，證據仍不足 |
| 2 | 原文的 pure repost | 保留討論訊號，但不增加獨立佐證或重複 Claim |
| 3 | 另一位作者的獨立回報，或新增品牌／批次陳述 | 產生新的 Experience 或 Hypothesis Claim |
| 4 | 主管機關公告或檢驗資料 | 對既有 Fact/Hypothesis Claim 執行 verification |
| 5 | 公告擴大影響範圍 | 讓 B 展示新候選不繼承舊核可 |
| 6 | 逐批檢驗後部分放行 | 反駁「所有擴大列管批次仍有問題」並縮小案件範圍 |

### 官方公告在 M1 的角色

M1 不實作網路 monitor。官方公告與新聞是 D 已放在較晚 stage 的 committed external
source，用來做 deterministic replay；A 不在執行時抓取網站。

若公告本身也要出現在市場時間軸，它可以同時扮演兩個角色：

- 作為新的 Signal 被 ingest，讓 B 將它加入既有 Case。
- 作為 Evidence 被 verifier 引用，支持或反駁較早的 Claim。

兩個角色可引用同一個 committed document 與 URL，不代表內容被視為兩份獨立證據。

## A 的處理流程

```text
D dataset stage
→ A deterministic loader
→ persist Signal
→ LLM claim extraction
→ validate contract and source quote
→ hand signal_id to B

B requests verification for claim_id
→ A loads the Claim and available committed Evidence
→ one structured-output LLM call
→ persist verification result and Evidence links
→ B advances the owning Case
```

## Verification prompt contract

Verifier 使用一個 bounded structured-output call。概念輸入為：

```json
{
  "claim": {
    "normalized_statement": "Demo 牌 B123 批次食用油不合格",
    "scope": {"region": null, "batch": "B123", "time_window": null}
  },
  "evidence": [
    {
      "evidence_id": "ev_001",
      "publisher": "Synthesized authority",
      "published_at": "2026-09-12T03:00:00Z",
      "excerpt": "公告 Demo 牌 B123 批次檢驗不合格"
    }
  ]
}
```

LLM 只能依提供的 evidence 判定：

- `supported`：資料直接支持 Claim。
- `refuted`：資料直接反駁 Claim。
- `insufficient_evidence`：沒有資料、資料不直接相關、資訊不足，或正反資料並存且
  無法形成單一結論。
- `not_applicable`：該 Claim 不適合做 evidence verification，例如純 request 或
  不含可外部查核命題的 experience。

中央 contract 目前沒有 `mixed` verification enum。M1 既然先遵守既有 contract，
正反證據並存時使用 `insufficient_evidence`，並在 Evidence items 分別保留
`supports` 與 `refutes` stance。若要加入明確 `mixed`，需由 B 協調 contract enum
變更後才能實作。

為滿足既有 Evidence contract，同一次 structured output 除了總體
`verification_status`，也需為每個輸入 Evidence 回傳
`supports | refutes | context_only` stance。這不需要第二次 LLM call。

## Failure and retry

- Claim extraction 與 verification 各最多兩次 model attempts：第一次執行加一次 retry。
- 第二次仍失敗時保留原始 Signal、Claim、Evidence 與失敗狀態，不產生推測結果。
- Model call 前後不持有 SQLite write transaction。
- M1 不實作複雜 retry scheduler；之後可以用新的明確操作重新執行。

## A 與 B 的 contract gate

M1 先完全沿用 `contracts/README.md`。A0 將既有的 `Signal`、`Claim` 與 `Evidence`
欄位直接實作成 `app/schemas.py` 內的共用 Pydantic models；A 的輸出 fixture 與 B 的
consumer 都 import 同一份 models，不在任何一端做欄位 translation。

Case 最終需要能保存所有相關 Signal，包括沒有新 Claim 的 pure repost。這是 B-side
Case 實作細節，不影響 A 的交付：A 一律透過 injected `dispatch(signal_id)` handoff
所有新 Signal。

## D handoff checklist

D 交付資料前，A 與 D 一起確認：

- 每篇 post 都有穩定 source key、原文、發布時間與 stage。
- Repost 明確指向原始 post；獨立回報不可誤標成 repost。
- 不強迫每篇 post 同時包含 fact、experience、hypothesis 和 request。
- Evidence 的來源、時間與 excerpt 完整；模擬貼文與真實外部文件各自保留正確標示。
- 每個 expected verification 都寫明哪些輸入支持它，以及不能推出哪些額外結論。
- 至少有一條 insufficient／反駁路徑，避免 demo 永遠只會升級。
