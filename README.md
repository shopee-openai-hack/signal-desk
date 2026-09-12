# shopee-openai-hack

Hackathon starter: Vite + React + TypeScript + Tailwind + shadcn/ui components + TanStack Query; Python + FastAPI + Pydantic + httpx + uv; OpenAI SDK + a bounded lightweight loop; SQLite; Railway; GitHub Actions.

Deployed infrastructure, verification evidence and remaining gates: [INFRA_STATUS.md](INFRA_STATUS.md).

## Local development（隊友與 Codex 從這裡開始）

在 repo 根目錄工作。需要 Git、Node.js 22（含 npm），以及 Python 3.12 或 3.13。
專案的 `uv` 與 Python packages 都安裝在 repo-local `.venv`；不依賴全域 `uv`。
一般本機開發不需要 Docker、Railway CLI 或雲端存取權。

### 1. 初次設定

尚未下載專案時：

```sh
git clone https://github.com/shopee-openai-hack/starter-repo.git
cd starter-repo
```

已有 checkout 就進入該目錄，不要重複 clone。先檢查 `git status --short`，保留既有修改。

```sh
node --version
python3.12 --version  # 或 python3.13
# 保留既有 .env，不覆寫隊友已設定的 key。
test -f .env || cp .env.example .env
scripts/bootstrap_venv.sh
.venv/bin/uv --version
(cd frontend && npm ci)
```

每個 checkout／worktree 各自有 `.env`、`.venv`、`frontend/node_modules` 和本機 SQLite。
`.env` 與 DB 不進 Git；不要把 production 的變數整包複製到本機。

### 2. 開兩個 terminal

Terminal A，在 repo 根目錄啟動 FastAPI：

```sh
.venv/bin/uv run uvicorn app.main:app --reload --env-file .env --port 8000
```

Terminal B，在 repo 根目錄啟動 Vite：

```sh
cd frontend
npm run dev -- --strictPort
```

開啟 **http://localhost:5173**。Vite 會將 `/api` 和 `/healthz` 轉送到
`http://localhost:8000`，前端程式使用相對 API 路徑。停止時在兩個 terminal 各按 Ctrl+C。
`--strictPort` 避免 Vite 自動換 port，導致與 PUBLIC_ORIGIN 不一致。

Signal Desk 四頁使用 FastAPI 的 `/api/v1/demo/*` 受控回放端點，預設從
Stage 3 開始，商品核可／模擬執行會保存在同一個 SQLite。無須另啟 Node mock。
一般 A+B ingest／verify／Case 工作流仍在 `/api/v1/*`，兩者資料分開；
回放資料不是即時模型輸出。完整操作與端點見 `frontend/README.md`。

### 3. 本機環境變數

在根目錄 `.env` 設定；變更後重啟後端。已 export 的 shell 環境變數會優先於 `.env`，
請使用一般 terminal，不要在載入 Railway production 變數的 shell 裡啟動本機服務。

| 變數 | 本機值／用途 |
| --- | --- |
| `APP_ENV` | `development` |
| `DATABASE_PATH` | `data/app.sqlite3`；後端啟動時自動初始化，不需另外架 DB |
| `PUBLIC_ORIGIN` | `http://localhost:5173`；與瀏覽器實際開啟的 origin 一致 |
| `SESSION_COOKIE_SECURE` | `false`；本機使用 HTTP |
| `SESSION_SECRET` | 範例值只供本機；保持不變才能沿用匿名 session |
| `OPENAI_API_KEY` | 空白即可開發，UI 會顯示範例模式；需要真實 AI 時自行加入 backend key |
| `OPENAI_MODEL` | 預設 `gpt-4o-mini` |

Railway 上的 key 不會自動同步到本機。不要把 key 貼到聊天、commit、`VITE_*` 或前端程式。
真實模式的提交會消耗 API 額度；provider 失敗會回報錯誤，不會偷偷改用 demo 結果。

### 4. 確認服務正常

兩個服務都啟動後，在另一個 terminal 執行：

```sh
curl -fsS http://localhost:8000/healthz
curl -fsS http://localhost:5173/healthz
curl -fsS http://localhost:5173/api/config
```

健康回應應包含 `status: "ok"`、`database: "ok"`；沒有 key 時 `mode` 為 `demo`。
在 UI 輸入一個目標並提交，確認顯示結果與歷史紀錄，再重新整理確認紀錄仍在。
匿名歷史依 cookie 區分；請固定使用 `localhost`，不要與 `127.0.0.1` 混用。

### 5. 提交前檢查

在 repo 根目錄：

```sh
.venv/bin/uv run pytest
(cd frontend && npm run typecheck && npm run build)
git diff --check
```

測試使用臨時 SQLite 與 fake provider，不會呼叫付費 AI。
只有修改依賴時才刻意更新 lockfile；不要為了跑起來刪除 `uv.lock` 或 `package-lock.json`。
Docker 修改可另外執行 `docker build -t hackathon-local .`，需要啟動 Docker daemon。

### 單一 origin 的 production build 預覽

先停止佔用 8000 的後端，再於根目錄執行：

```sh
(cd frontend && npm run build)
PUBLIC_ORIGIN=http://localhost:8000 .venv/bin/uv run uvicorn app.main:app --env-file .env --port 8000
```

開啟 http://localhost:8000，由 FastAPI 同時提供前端與 API。這只覆寫此次程序的 origin，
不更動 `.env`；回到雙 terminal 開發時使用原本指令。`vite preview` 本身不代表完整後端驗證。

### 常見問題

| 現象 | 處理方式 |
| --- | --- |
| 5173 已被占用 | 找出既有開發程序，確認是否可沿用或停止；不要盲目 kill 隊友程序 |
| API proxy connection refused | 確認 Terminal A 正常啟動且 port 為 8000 |
| 提交回傳 403 | 檢查 PUBLIC_ORIGIN、網址的 host／port 是否完全一致，重啟後端 |
| 本機要求 Railway volume／HTTPS | 清除 shell 中的 production／RAILWAY_* 覆寫，使用本機 `.env` |
| 429／額度已達上限 | 每分鐘與每日限制是預期行為；只在自己的本機 `.env` 調整測試額度 |
| 改了 key 仍是 demo | 確認修改根目錄 `.env`、沒有 shell 覆寫，並重啟後端 |
| 歷史紀錄消失 | 檢查 cookie、SESSION_SECRET、host 與 DATABASE_PATH；不要先刪 DB |

需要空白測試資料時，用另一個 `DATABASE_PATH` 啟動本機後端，保留原資料庫。

### 給 Codex 的開工提示

可直接貼給隊友的 Codex：

> 請先讀 AGENTS.md 與 README.md 的 Local development，再檢查 git status。
> 保留現有修改與 .env，依 lockfile 安裝依賴，啟動本機前後端並驗證 health 與 UI。
> 沒有 OPENAI_API_KEY 就用 demo 模式。實作後執行 README 的提交前檢查，
> 回報修改與驗證結果；除非我授權，不要 commit、push 或變更 Railway production。

程式入口：`frontend/src/App.tsx` 是 UI，`app/main.py` 是 HTTP API，
`app/schemas.py` 是資料合約，`app/planner.py` 是 AI 邏輯，`app/store.py` 是 SQLite。
新增 shadcn 元件時從 `frontend` 執行其 CLI；既有 alias、tokens 和 components.json 可沿用。

## Railway

Deploy ONE application service, ONE replica and ONE Uvicorn worker. Attach a persistent Railway Volume at `/data` before the first deployment. Set:

- `APP_ENV=production`
- `DATABASE_PATH=/data/app.sqlite3`
- `SESSION_SECRET`: a generated random secret, at least 32 characters
- `SESSION_COOKIE_SECURE=true`
- `PUBLIC_ORIGIN=https://your-generated-domain`
- `OPENAI_API_KEY`: backend secret; omit for explicit demo mode
- `OPENAI_MODEL=gpt-4o-mini` (or a verified compatible model)
- `PORT=8080`

Set Railway healthcheck `/healthz`, Dockerfile build, restart on failure, and retain one replica. The app checks Railway's injected `RAILWAY_VOLUME_MOUNT_PATH`; do not spoof it as a variable to bypass the volume requirement. The SQLite directory must stay on the volume; image filesystems are disposable. Initialize the DB at runtime, not during image build or pre-deploy. WAL and SHM files belong beside the database. Use Railway volume backups or SQLite's backup API, not a blind copy of only the live database file. Volume-backed deployments may briefly interrupt requests.

For a manual first deploy, use Railway CLI after linking the correct project/environment/service. Confirm platform deployment SUCCESS and `/healthz`, then create one run and restart the app to verify it survives. Do not run multiple replicas against this SQLite design.

## GitHub Actions

The included workflow runs Python tests, TypeScript checks, Vite build and Docker build on PRs; it exposes no deployment secrets to PRs. The main-branch deploy job runs only after tests and opt-in configuration.

Configure the GitHub `production` environment:

- Secret `RAILWAY_TOKEN`: a project/environment-scoped Railway token, not an account-wide token.
- Variables `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID`, `APP_URL`.
- Repository variable `RAILWAY_DEPLOY_ENABLED=true` only after the Railway service and `/data` volume exist.

Set environment approval rules if desired. Disable Railway's direct GitHub auto-deploy when using this workflow, so it cannot deploy before CI passes. The workflow records the uploaded deployment ID and verifies that exact deployment. `workflow_dispatch` on main supports retrying a known commit. Never put the OpenAI key in frontend `VITE_*` variables or GitHub build args.

## Defaults and limits

One process, anonymous signed browser sessions; clearing cookies loses access to history. Total 8 submissions/minute, 100 admissions per UTC day stored transactionally, 2 concurrent model jobs, max 2 model attempts, 1000 output tokens per attempt, 500 input characters, 16KB request body. DB connections/transactions are short and close before awaiting a model. Interrupted runs become failed after 15 minutes when history/readiness is checked. No automatic job resume, login accounts, external tool execution, ORM, Postgres or Redis.

Extend product models in `app/schemas.py`, agent logic in `app/planner.py`, persistence in `app/store.py`, and UI in `frontend/src/App.tsx`. Use TanStack Query for server state and invalidate `runs` after mutations. Do not auto-retry cost-bearing mutations. Keep sample mode visible.
