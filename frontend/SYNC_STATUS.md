# Frontend integration snapshot

2026-09-12。版本快照，不是跨 worktree 即時工作板。

四頁已接 FastAPI `/api/v1/demo/*`；SQLite 保存展示進度、商品、核可與執行。垂直 Trace、獨立底部播放器、側欄收合及案件時間軸新到舊排序已整合。專員狀態使用業務描述，回放序號只供展示控制使用。

即時 A/B APIs 與展示狀態分離；目前 UI 不會因加入模型 key 就改接即時流程。正式整合邊界以 [中央合約](../contracts/README.md) 為準。

- [目前操作與端點](README.md)
- [提交準備與未完成驗收](../docs/SUBMISSION.md)
- [早期 mock 交接紀錄](../docs/history/frontend-sync-2026-09-12.md)（歷史資料）
