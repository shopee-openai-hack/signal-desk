from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI

from .claim_extraction import (
    ClaimExtractor,
    ClaimExtractorProtocol,
    OpenAIClaimDraftProvider,
)
from .claim_verification import ClaimVerificationService, OpenAIVerificationProvider
from .config import Settings
from .demo_loader import EvidenceInput, load_evidence
from .planner import PlanGenerationError, Planner
from .rate_limit import BoundedConcurrency, InMemoryRateLimiter
from .schemas import ConfigResponse, GoalRequest, HealthResponse, RunResponse
from .session import new_session, verify_session
from .signal_api import (
    CaseDispatcherProtocol,
    ClaimVerifierProtocol,
    NoopCaseDispatcher,
    SignalAPI,
    UnavailableClaimExtractor,
    UnavailableVerificationProvider,
    create_signal_router,
)
from .signal_store import SQLiteSignalStore, SignalStoreUnavailable
from .store import SQLiteRunStore, DailyLimitReached, RunRecord, RunStoreProtocol, StoreUnavailable

logger = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = BASE_DIR / "frontend" / "dist"
MAX_REQUEST_BYTES = 16_000
STALE_RUN_ERROR = "這筆規劃逾時，請重新試一次。"


class RequestBodyLimitMiddleware:
    def __init__(self, app, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        received_bytes = 0
        terminated = False

        async def send_too_large() -> None:
            nonlocal terminated
            if terminated:
                return
            terminated = True
            body = b'{"error":{"code":"request_too_large","message":"\\u8acb\\u628a\\u76ee\\u6a19\\u7e2e\\u77ed\\u5f8c\\u518d\\u8a66\\u3002"}}'
            await send(
                {
                    "type": "http.response.start",
                    "status": 413,
                    "headers": [[b"content-type", b"application/json"], [b"content-length", str(len(body)).encode("ascii")]],
                }
            )
            await send({"type": "http.response.body", "body": body})

        async def limited_receive():
            nonlocal received_bytes
            if terminated:
                return {"type": "http.disconnect"}
            message = await receive()
            if message.get("type") == "http.request":
                received_bytes += len(message.get("body", b""))
                if received_bytes > self.max_bytes:
                    await send_too_large()
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message):
            if not terminated:
                await send(message)

        await self.app(scope, limited_receive, guarded_send)


def _normalise_origin(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return None
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment or parsed.username or parsed.password:
            return None
        port = parsed.port
    except ValueError:
        return None
    host = parsed.hostname.lower()
    if (parsed.scheme.lower(), port) in {("http", 80), ("https", 443)}:
        port = None
    suffix = f":{port}" if port else ""
    return f"{parsed.scheme.lower()}://{host}{suffix}"


def _request_origin(request: Request) -> str:
    return f"{request.url.scheme}://{request.url.netloc}"


def _as_response(record: RunRecord) -> RunResponse:
    return RunResponse(
        id=record.id,
        goal=record.goal,
        status=record.status,
        mode=record.plan.mode if record.plan else None,
        plan=record.plan,
        error=record.error,
        created_at=record.created_at,
        completed_at=record.completed_at,
    )


def _error(code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def create_app(
    settings: Settings | None = None,
    store: RunStoreProtocol | None = None,
    planner: Any | None = None,
    *,
    signal_store: SQLiteSignalStore | None = None,
    claim_extractor: ClaimExtractorProtocol | None = None,
    claim_verifier: ClaimVerifierProtocol | None = None,
    case_dispatcher: CaseDispatcherProtocol | None = None,
    evidence_loader: Callable[[list[str], int], list[EvidenceInput]] = load_evidence,
) -> FastAPI:
    app_settings = settings or Settings.from_env()
    app_store = store or SQLiteRunStore(app_settings.db_path, app_settings.db_connect_timeout_seconds)
    app_planner = planner or Planner(app_settings)
    app_signal_store = signal_store or SQLiteSignalStore(
        app_settings.db_path,
        app_settings.db_connect_timeout_seconds,
    )
    owned_async_resources: list[Any] = []
    if claim_extractor is None:
        if app_settings.openai_api_key:
            extraction_provider = OpenAIClaimDraftProvider(app_settings)
            owned_async_resources.append(extraction_provider)
            app_claim_extractor = ClaimExtractor(extraction_provider)
        else:
            app_claim_extractor = UnavailableClaimExtractor()
    else:
        app_claim_extractor = claim_extractor

    if claim_verifier is None:
        if app_settings.openai_api_key:
            verification_client = AsyncOpenAI(
                api_key=app_settings.openai_api_key,
                timeout=app_settings.model_timeout_seconds,
                max_retries=0,
                http_client=httpx.AsyncClient(
                    timeout=app_settings.model_timeout_seconds
                ),
            )
            owned_async_resources.append(verification_client)
            app_claim_verifier = ClaimVerificationService(
                OpenAIVerificationProvider(
                    verification_client,
                    app_settings.openai_model,
                )
            )
        else:
            app_claim_verifier = ClaimVerificationService(
                UnavailableVerificationProvider()
            )
    else:
        app_claim_verifier = claim_verifier

    app_case_dispatcher = case_dispatcher or NoopCaseDispatcher()
    app_signal_api = SignalAPI(
        app_signal_store,
        app_claim_extractor,
        app_claim_verifier,
        evidence_loader,
        app_case_dispatcher,
    )
    limiter = InMemoryRateLimiter(app_settings.rate_limit_per_minute)
    global_limiter = InMemoryRateLimiter(app_settings.global_rate_limit_per_minute)
    concurrency = BoundedConcurrency(app_settings.max_concurrent_requests)

    def cleanup_stale_runs() -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=app_settings.running_ttl_seconds)
        app_store.fail_stale_running(cutoff, STALE_RUN_ERROR)

    def initialise_database(app: FastAPI) -> bool:
        try:
            app_store.init_schema()
            app_signal_store.init_schema()
            if not app_store.ping():
                app.state.db_ready = False
                return False
            cleanup_stale_runs()
            app.state.db_ready = True
            return True
        except StoreUnavailable:
            app.state.db_ready = False
            logger.warning("SQLite readiness check failed")
            return False
        except Exception as exc:  # noqa: BLE001 - healthz must stay sanitized
            app.state.db_ready = False
            logger.warning("database readiness check failed: %s", type(exc).__name__)
            return False

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db_ready = False
        initialise_database(app)
        yield
        close = getattr(app_planner, "close", None)
        if close:
            await close()
        for resource in owned_async_resources:
            await resource.close()

    app = FastAPI(title="Hackathon Agent Starter", version="0.1.0", lifespan=lifespan)
    app.state.settings = app_settings
    app.state.store = app_store
    app.state.planner = app_planner
    app.state.signal_store = app_signal_store
    app.state.signal_api = app_signal_api

    @app.middleware("http")
    async def request_limits(request: Request, call_next):
        is_mutation = request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path.startswith("/api/")
        if is_mutation:
            content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                return _error("unsupported_media_type", "請使用 application/json 傳送目標。", status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)
            origin = request.headers.get("origin")
            if origin:
                expected_origin = _normalise_origin(app_settings.public_origin) or _normalise_origin(_request_origin(request))
                if _normalise_origin(origin) != expected_origin:
                    return _error("origin_not_allowed", "這個來源未被允許。", status.HTTP_403_FORBIDDEN)

        content_length = request.headers.get("content-length")
        if content_length:
            try:
                too_large = int(content_length) > MAX_REQUEST_BYTES
            except ValueError:
                return _error("invalid_request", "請檢查請求內容後再試。", 400)
            if too_large:
                return _error("request_too_large", "請把目標縮短後再試。", 413)
        visitor_id = verify_session(request.cookies.get(app_settings.session_cookie_name), app_settings.session_secret)
        if visitor_id is None:
            visitor_id, cookie_value = new_session(app_settings.session_secret)
            request.state.new_session_cookie = cookie_value
        request.state.visitor_id = visitor_id
        response = await call_next(request)
        if getattr(request.state, "new_session_cookie", None):
            response.set_cookie(
                key=app_settings.session_cookie_name,
                value=request.state.new_session_cookie,
                max_age=app_settings.session_max_age_seconds,
                httponly=True,
                secure=app_settings.session_cookie_secure,
                samesite="lax",
                path="/",
            )
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        del request, exc
        return _error("invalid_request", "請檢查目標內容後再試。", 422)

    @app.exception_handler(StoreUnavailable)
    async def store_error_handler(request: Request, exc: StoreUnavailable):
        logger.warning("store unavailable for %s: %s", request.url.path, type(exc).__name__)
        return _error("database_unavailable", "資料暫時無法儲存，請稍後再試。", status.HTTP_503_SERVICE_UNAVAILABLE)

    @app.exception_handler(SignalStoreUnavailable)
    async def signal_store_error_handler(request: Request, exc: SignalStoreUnavailable):
        logger.warning("signal store unavailable for %s: %s", request.url.path, type(exc).__name__)
        return _error("database_unavailable", "訊號資料暫時無法儲存，請稍後再試。", status.HTTP_503_SERVICE_UNAVAILABLE)

    @app.get("/api/config", response_model=ConfigResponse)
    async def get_config() -> ConfigResponse:
        return ConfigResponse(
            mode="demo" if app_settings.demo_mode else "live",
            max_goal_chars=app_settings.max_goal_chars,
            rate_limit_per_minute=app_settings.rate_limit_per_minute,
        )

    @app.get("/healthz", response_model=HealthResponse)
    async def healthz() -> HealthResponse:
        if not initialise_database(app):
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"status": "error", "database": "unavailable"},
            )  # type: ignore[return-value]
        return HealthResponse(
            status="ok",
            database="ok",
            mode="demo" if app_settings.demo_mode else "live",
        )

    @app.post("/api/plans", response_model=RunResponse, status_code=status.HTTP_201_CREATED)
    async def create_plan(payload: GoalRequest, request: Request) -> RunResponse:
        goal = payload.goal
        if len(goal) > app_settings.max_goal_chars:
            return JSONResponse(
                status_code=422,
                content={"error": {"code": "goal_too_long", "message": f"目標請控制在 {app_settings.max_goal_chars} 字以內。"}},
            )  # type: ignore[return-value]
        visitor_id = request.state.visitor_id
        if not limiter.allow(visitor_id):
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"error": {"code": "rate_limited", "message": "今天先停一下，稍後再試。"}},
            )  # type: ignore[return-value]
        if not global_limiter.allow("__global__"):
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"error": {"code": "global_rate_limited", "message": "目前請求量較高，請稍後再試。"}},
            )  # type: ignore[return-value]
        if not await concurrency.try_acquire():
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"error": {"code": "concurrency_limited", "message": "目前有太多規劃正在處理，請稍後再試。"}},
            )  # type: ignore[return-value]
        try:
            try:
                run = app_store.create_running(visitor_id, goal, app_settings.daily_request_limit)
            except DailyLimitReached:
                return _error("daily_limit_reached", "今天的規劃額度已用完，明天再回來。", 429)
            try:
                plan = await app_planner.generate(goal)
            except PlanGenerationError as exc:
                failed = app_store.fail(run.id, visitor_id, str(exc))
                return JSONResponse(status_code=status.HTTP_502_BAD_GATEWAY, content=_as_response(failed).model_dump(mode="json"))  # type: ignore[return-value]
            except Exception as exc:  # noqa: BLE001 - do not expose implementation details
                logger.warning("unexpected planning failure: %s", type(exc).__name__)
                failed = app_store.fail(run.id, visitor_id, "AI 暫時無法產生規劃，請稍後再試。")
                return JSONResponse(status_code=status.HTTP_502_BAD_GATEWAY, content=_as_response(failed).model_dump(mode="json"))  # type: ignore[return-value]
            completed = app_store.complete(run.id, visitor_id, plan)
            return _as_response(completed)
        finally:
            concurrency.release()

    @app.get("/api/runs", response_model=list[RunResponse])
    async def list_runs(request: Request) -> list[RunResponse]:
        cleanup_stale_runs()
        records = app_store.list_for_visitor(request.state.visitor_id, app_settings.max_history_items)
        return [_as_response(record) for record in records]

    @app.get("/api/runs/{run_id}", response_model=RunResponse)
    async def get_run(run_id: UUID, request: Request) -> RunResponse:
        cleanup_stale_runs()
        record = app_store.get_for_visitor(request.state.visitor_id, run_id)
        if record is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這筆規劃")
        return _as_response(record)

    app.include_router(create_signal_router(app_signal_api))

    if DIST_DIR.is_dir():
        app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/") or path == "healthz":
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            candidate = (DIST_DIR / path).resolve()
            try:
                candidate.relative_to(DIST_DIR.resolve())
            except ValueError:
                candidate = DIST_DIR / "index.html"
            if candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(DIST_DIR / "index.html")

    # Register last so the byte guard is the outermost middleware and can
    # terminate an oversized stream before BaseHTTPMiddleware sees it.
    app.add_middleware(RequestBodyLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)
    return app


app = create_app()
