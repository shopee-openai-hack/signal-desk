# Infrastructure status

Verified 2026-09-12. This is evidence for infrastructure, not product acceptance.

## Deployment target

- GitHub: https://github.com/shopee-openai-hack/starter-repo
- Railway project: `starter-repo`, `f87b0ed2-710b-41ee-b07a-153df5cad254`
- Workspace: `minchenlee's Projects`
- Environment: `production`, `9c34bdd7-44bc-4f6d-8dab-5a6ee8652113`
- Service: `starter-repo`, `5ad80c8e-3fb5-4d69-8d17-4076f2053f0f`
- Public URL: https://starter-repo-production.up.railway.app
- Volume: `b2d0bd3e-055e-4f96-8cf8-a44ac7603aa6`, 500 MB, mounted at `/data`.
- SQLite: `/data/app.sqlite3`; one replica and one Uvicorn worker.
- Dockerfile build, `/healthz` readiness (120 seconds), ON_FAILURE restart (3 retries).
- No direct GitHub source connected to Railway; GitHub Actions owns automated deployment.

## Configuration

Production environment, secure session cookies, generated session secret, matching HTTPS
PUBLIC_ORIGIN, and PORT=8080 are configured on Railway. Provider secrets stay backend-only.
OPENAI_API_KEY is configured on Railway: the current app runs in live mode.
The key was not retrieved or copied into local files.

GitHub `production` has APP_URL, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID variables
and an encrypted RAILWAY_TOKEN secret. The mistakenly created plaintext token variable
was removed. Repository RAILWAY_DEPLOY_ENABLED is true.

Local `.env` has been initialized with a unique secret and restrictive permissions;
it is ignored by Git. No OpenAI key was copied from another project.

## Evidence

- Live-provider deployment `b43b4ff9-af3e-4ba5-867e-4dbdbfb7028f` succeeded
  on 2026-09-12. HTTPS readiness reports mode=live and database=ok.
- One real AI request completed: `aee02666-4c92-41cf-97de-5a1755d99bb4`.
  Stored run and plan both report live mode, with three generated steps;
  history retrieval and cross-session denial passed.

- Local frozen Python dependency sync; 8 tests passed, including SQLite isolation,
  restart persistence, atomic quota admission and provider failure handling.
- Frontend clean install, TypeScript checks and production build passed.
- Local Docker daemon is stopped; Docker builds passed on GitHub and Railway.
- First deployment: `8004b5f1-f6a3-45c3-b741-59212f26dcd9`, SUCCESS.
  Source was clean archive of local HEAD `7cbf9d24e3e9aa79c0cbc465f6feef59eb1e1283`.
- Live HTTPS health, frontend page, synthetic plan creation, history and cross-session
  denial passed. Secure and HttpOnly session-cookie attributes verified.
- Run `138a55e6-c459-4286-b698-1fcffa91a405` survived a Railway restart;
  logs confirmed application startup at 2026-09-12T05:34:43Z.
- Browser rendered demo mode, submitted a plan, and displayed its completed history entry.
- GitHub full pipeline: https://github.com/shopee-openai-hack/starter-repo/actions/runs/34675926239
  Both test and deploy jobs succeeded. Source: `7a7411dfc2e45a8131c41852b336ce4583da516a`.
  Railway deployment: `9f0ebb8a-3a26-4608-9558-9c3d470cde98`, SUCCESS.
- The same synthetic run remained readable after the GitHub Actions deployment;
  history and cross-session denial checks passed again.

## Recheck and recovery

```sh
uv run python scripts/smoke_deployment.py https://starter-repo-production.up.railway.app /tmp/starter-smoke.json
```

First invocation creates one synthetic plan; in live mode this may consume model quota.
Repeat with the same state file after a confirmed restart/redeploy to verify persistence.
The file contains an anonymous session cookie; keep it outside Git and remove it after use.

Deploy through main-branch CI or `gh workflow run ci.yml --ref main`. Check both the
workflow result and exact Railway deployment ID. Inspect Railway logs on failure.
Do not delete the volume, use ephemeral SQLite, or add replicas to recover a deployment.

## Remaining gates

- Daily volume-backup setup is blocked: Railway API returned Not Authorized;
  schedule query returned no schedules. User has been asked to enable Daily in the UI.
  Restore drill has not been performed.
- Product implementation and acceptance are separate from this infrastructure setup.

Reference: https://docs.railway.com/volumes/backups
