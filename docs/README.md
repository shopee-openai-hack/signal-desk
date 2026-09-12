# 文件索引

提交與閱讀入口以根目錄 [README](../README.md) 和 [提交概覽](SUBMISSION.md) 為主。以下文件保留不同責任，不把設計目標當成已完成驗收。

| 分類 | 文件 | 用途／權威 |
| --- | --- | --- |
| 產品 | [INTENT](../INTENT.md) | 產品範圍、決策與成功條件；Draft 標籤保留，未代替 owner 簽核 |
| 實作規格 | [SPEC](../SPEC.md)、[tasks](../tasks.md) | A 的訊號與查核實作規格及工作分解，不是全專案完成狀態 |
| 工作分工 | [Issues](../issues/README.md) | A/B/C/D 原始交付與驗收範圍 |
| 整合 | [Contracts](../contracts/README.md) | API、資料型別、producer 邊界 |
| 前端 | [README](../frontend/README.md)、[INTENT](../frontend/INTENT.md)、[PRODUCT](../frontend/PRODUCT.md) | 啟動、已確認互動與產品語意 |
| Trace | [Trace contract](../frontend/TRACE_CONTRACT_PROPOSAL.md) | 保存的 phases、activities、快照與重試結構 |
| 視覺 | [DESIGN](../frontend/DESIGN.md) | 已暫緩的提案；不是目前 UI 權威 |
| Demo | [Demo pack](demo/demo-pack.md)、[業務規則](demo/business-rules.md) | 情境輸入、證明／不證明、商品處置邊界 |
| 排練 | [腳本](demo/demo-script.md)、[驗收清單](demo/acceptance-checklist.md) | 六分鐘舞台腳本與人工簽核；不是已錄製影片證據 |
| 來源 | [訊號展示](demo/signal-showcase.md)、[研究](../reference_召回痛點研究.md) | 來源背景，對外引用前仍需核對 |
| 部署 | [INFRA_STATUS](../INFRA_STATUS.md) | 記錄的部署證據；最新產品 commit 須另驗 |
| 現況 | [Frontend sync](../frontend/SYNC_STATUS.md) | 目前整合邊界 |
| 歷史 | [早期 frontend sync](history/frontend-sync-2026-09-12.md)、[Demo handoff](demo/handoff.md) | 原始交接背景，勿沿用舊啟動命令或完成宣告 |

## 提交整理原則

- 不刪除原始規格、owner 決策及來源紀錄；舊交接改由歷史入口引用。
- Stage 是展示控制游標，僅出現在操作文件或展開的展示設定；專員狀態使用可理解的業務描述。
- 「已保存的處理紀錄」不能宣稱為即時模型執行；示範商品與真實來源需可辨識。
- 本機測試、瀏覽器排練、雲端驗收與正式提交分別留證據。
- `.env`、SQLite、`.DS_Store`、本機 `outputs/` 不納入提交；影片以確認過的最終檔或連結提交。
