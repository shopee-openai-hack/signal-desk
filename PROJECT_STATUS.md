# Project status

Last verified: 2026-09-12。Stale after: 下一次程式或部署變更。
Authority: Version snapshot only；即時指派、進度及阻塞在 shared store。

## Current outcome

Signal Desk 四頁已整合 SQLite-backed FastAPI 受控展示。現在整理提交文件與專員狀態文案；尚未正式提交。分支與 dirty state 請即時查看 `git status`，不依文件推測。

## Verification state

本次：pytest 139 passed，frontend typecheck/build、diff check 通過。尚未驗證本次文案的瀏覽器顯示、最終部署版本、人工來源簽核及最終影片。

## Next safe actions

1. 依 [提交概覽](docs/SUBMISSION.md) 完成來源核對及最終部署排練。
2. 對齊影片 task 產出與最新畫面，確認提交規格。
3. 確認最終 commit、部署與影片連結後正式提交。

## Routes

- [文件索引](docs/README.md)、[待驗收項目](docs/BACKLOG.md)
- [規格](INTENT.md)、[契約](contracts/README.md)、[歷史](docs/history/frontend-sync-2026-09-12.md)
- [Active plans](docs/plans/active/README.md)、[Completed plans](docs/plans/completed/README.md)

```sh
python3 /Users/liminchen/.codex/skills/agent-project-system/scripts/shared_status.py --repo . status
```

此文件不取代 shared store；既有角色回報不能直接推定為驗收完成。

## Live workstreams

即時工作分配使用上面的 shared status 指令；此版僅記錄提交準備與即時 API 整合的邊界。

## Human decisions / blockers

展示使用保存紀錄；正式提交規格、來源簽核、最終影片與部署版本待確認。沒有授權自動提交至主辦方。

## Update contract

程式或部署改動後重新驗證，更新本版證據與 SUBMISSION 清單；不將歷史測試改寫為最新結果。
