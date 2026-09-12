# shopee-openai-hack

Hackathon starter: Vite + React + TypeScript + Tailwind + shadcn/ui components + TanStack Query; Python + FastAPI + Pydantic + httpx + uv; OpenAI SDK + a bounded lightweight loop; SQLite; Railway; GitHub Actions.

## Local development

```sh
cp .env.example .env
uv sync --frozen --dev
uv run uvicorn app.main:app --reload --env-file .env --port 8000
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to FastAPI; `PUBLIC_ORIGIN` in `.env` matches this origin. SQLite initializes at `data/app.sqlite3` on startup. No separate database server. The bundled action planner is replaceable sample product code, not a required product direction. Without an OpenAI key it is explicitly demo mode; provider failures never fall back silently.

For single-origin local preview, run `npm run build` in `frontend`, set `PUBLIC_ORIGIN=http://localhost:8000` in `.env`, then start FastAPI. To add shadcn components, run its CLI from `frontend`; `components.json`, the `@` alias and CSS tokens are included.

## Checks

```sh
uv run pytest
cd frontend && npm run typecheck && npm run build
```

SQLite tests use temporary real files, including atomic quota admission, isolation, restart persistence, and error handling. Model-loop tests use a fake provider and make no paid API calls.

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
