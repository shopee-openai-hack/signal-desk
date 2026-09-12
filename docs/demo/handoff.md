# D 工作線交接給 A／B／C

Owner: D

Status: Ready for integration

Last updated: 2026-09-12

共同業務來源是 `docs/demo/demo-pack.md`，機器可讀輸入與預期範例位於 `contracts/fixtures/demo/`，決策邊界見 `docs/demo/business-rules.md`，現場操作與驗收分別見 `docs/demo/demo-script.md`、`docs/demo/acceptance-checklist.md`。預期狀態是 evaluation examples，不可直接當成模型的 hard-coded answers。

## 給 A：訊號抽取與外部查核

A 從 `contracts/fixtures/demo/signals.json` 取得六段 ingestion 輸入，從 `contracts/fixtures/demo/evidence.json` 取得 Stage 4–6 的查核證據，並以 `docs/demo/demo-pack.md` 的「證明／不證明」作為語意邊界。Stage 1 必須抽出三種陳述：推測「泰山某批沙拉油正被通路收回」、個人經驗「作者自家的油味道怪」、需求「詢問其他人是否遇到」；不可把個人經驗升格成食安證據。Stage 2 必須辨識為 `post_001` 的 repost，Stage 3 必須保留不同作者帶入的新品牌、上游與批號。Stage 4 支持 `clm_s3_fact_zhonglian`，Stage 5 支持 `clm_s5_scope_expansion`，Stage 6 對模擬批號 `315-1150411` 的陳述提供 refutes 證據。尚未定的是 Threads 實際蒐集方式、失敗狀態樣本，以及來源重試與成本上限；公告和新聞的標題、發布日期、數字與摘錄也需在 demo 前由人員開啟原始來源逐字核對，尤其 Stage 6 的回放結果日期與新聞頁 URL 日期要確認如何呈現。

## 給 B：案件分派與適應

B 從 `contracts/fixtures/demo/signals.json` 與 `contracts/fixtures/demo/evidence.json` 接收輸入，以 `contracts/fixtures/demo/expected_case_states.json` 作為六段的 evaluation examples，並依 `docs/demo/business-rules.md` 實作業務邊界。Stage 1 建立 `pending`／`medium` 案件；Stage 2 保存來源但不得重跑查核、增加獨立來源數或建立新案件；Stage 3–6 需形成 `high → critical → critical → high` 的可追溯更新，保留舊版本與每次調整理由。Stage 5 的新商品不得繼承 Stage 4 核可；Stage 6 要縮小 `prod_009` 的範圍，但保留 `prod_007` 為 candidate，因主線沒有執行 Stage 5 的可選核可。依 Morris 的決定，Stage 1 不把非沙拉油 `prod_006` 列為候選。尚未定的是歸案與相似度的實作方法、並行案件與總成本上限，以及 INT-S4 的雙向影響與 INT-S8 的不相關案件是否另補輸入；如要做操作驗收，由 B 決定最小新增樣本。

## 給 C：案件畫面、核可與模擬下架

C 從 `contracts/fixtures/demo/products.json` 取得九筆起始商品，從 `contracts/fixtures/demo/expected_case_states.json` 取得各段畫面預期，以 `docs/demo/demo-script.md` 的六分鐘走位和 `docs/demo/acceptance-checklist.md` 驗收。起始狀態為九筆 `active`、零案件。Stage 4 只允許 `prod_001`、`prod_003`、`prod_005` 進入核可清單；核可與執行後三筆改為 `delisted`，立即重新整理仍須保持該狀態，並能從時間軸追到案件版本、核可與執行結果。Stage 5 的 `prod_007`、`prod_009` 必須顯示需要新核可，不能自動下架；本輪主線不執行可選核可。Stage 6 的放行只把尚未核可的 `prod_009` 改為 excluded，已下架商品不自動恢復。尚未定的是一鍵重置指令、現場畫面實際欄位位置、備援影片路徑與展示裝置；C 完成後需把 `TBD by C` 和備援勾選項補齊。
