# Hackathon application

Read README.md first. Preserve the chosen stack: React/Vite/TypeScript/Tailwind/shadcn/TanStack Query, FastAPI/Pydantic/httpx/uv, OpenAI SDK lightweight loop, SQLite and Railway.

Local onboarding authority: README.md → "Local development". Follow its two-terminal startup, environment table, smoke checks and troubleshooting. Default to local demo mode when no backend key is available; do not fetch production secrets for local development. Read INFRA_STATUS.md for recorded cloud evidence and remaining gates.

Commands: `scripts/bootstrap_venv.sh`; `.venv/bin/uv run pytest`; `cd frontend && npm ci && npm run typecheck && npm run build`; `docker build -t hackathon-local .`.

SQLite lives at DATABASE_PATH, `/data/app.sqlite3` on Railway's persistent volume. Use one replica/worker, short parameterized transactions, and never hold a write lock while awaiting an API. Keep frontend API paths relative. Provider keys stay backend-only. This is a starter: adapt the example planner to the requested product rather than expanding the infrastructure.

Preserve existing authorization boundaries for commits, GitHub publication, secrets and Railway deployment. A local build does not prove a cloud deployment or a GitHub Actions run. Report these gates separately. Follow any user-provided shared task-board instructions before claiming repository work.

Submission documentation routes: [PROJECT_STATUS.md](PROJECT_STATUS.md) is a version snapshot; [docs/BACKLOG.md](docs/BACKLOG.md) and [docs/SUBMISSION.md](docs/SUBMISSION.md) list remaining acceptance. Live assignments remain in the shared store.
