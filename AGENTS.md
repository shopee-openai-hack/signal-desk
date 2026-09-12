# Hackathon application

Read README.md first. Preserve the chosen stack: React/Vite/TypeScript/Tailwind/shadcn/TanStack Query, FastAPI/Pydantic/httpx/uv, OpenAI SDK lightweight loop, SQLite and Railway.

Commands: `uv sync --frozen --dev`; `uv run pytest`; `cd frontend && npm ci && npm run typecheck && npm run build`; `docker build -t hackathon-local .`.

SQLite lives at DATABASE_PATH, `/data/app.sqlite3` on Railway's persistent volume. Use one replica/worker, short parameterized transactions, and never hold a write lock while awaiting an API. Keep frontend API paths relative. Provider keys stay backend-only. This is a starter: adapt the example planner to the requested product rather than expanding the infrastructure.

Preserve existing authorization boundaries for commits, GitHub publication, secrets and Railway deployment. A local build does not prove a cloud deployment or a GitHub Actions run. Report these gates separately. Follow any user-provided shared task-board instructions before claiming repository work.
