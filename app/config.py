from __future__ import annotations

import os
from dataclasses import dataclass


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    db_path: str
    session_secret: str
    session_cookie_secure: bool
    session_cookie_name: str
    session_max_age_seconds: int
    public_origin: str | None
    openai_api_key: str | None
    openai_model: str
    model_timeout_seconds: float
    max_model_steps: int
    rate_limit_per_minute: int
    global_rate_limit_per_minute: int
    daily_request_limit: int
    max_concurrent_requests: int
    running_ttl_seconds: int
    db_connect_timeout_seconds: int
    max_goal_chars: int
    max_history_items: int
    port: int

    @property
    def demo_mode(self) -> bool:
        return not bool(self.openai_api_key)

    @classmethod
    def from_env(cls) -> "Settings":
        if os.getenv("APP_ENV") == "production":
            if len(os.getenv("SESSION_SECRET", "")) < 32:
                raise RuntimeError("Production requires a random SESSION_SECRET of at least 32 characters")
            if not os.getenv("PUBLIC_ORIGIN", "").startswith("https://"):
                raise RuntimeError("Production requires an HTTPS PUBLIC_ORIGIN")
            if not _as_bool(os.getenv("SESSION_COOKIE_SECURE"), False):
                raise RuntimeError("Production requires SESSION_COOKIE_SECURE=true")
        if os.getenv("RAILWAY_ENVIRONMENT_ID"):
            from pathlib import Path
            mount = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
            db = Path(os.getenv("DATABASE_PATH", "data/app.sqlite3")).resolve()
            if not mount or not db.is_relative_to(Path(mount).resolve()):
                raise RuntimeError("Railway requires DATABASE_PATH inside its attached persistent volume")
        return cls(
            db_path=os.getenv("DATABASE_PATH", "data/app.sqlite3"),
            session_secret=os.getenv(
                "SESSION_SECRET",
                "local-development-secret-change-me-before-deploying",
            ),
            session_cookie_secure=_as_bool(
                os.getenv("SESSION_COOKIE_SECURE"),
                default=False,
            ),
            session_cookie_name=os.getenv("SESSION_COOKIE_NAME", "next_step_session"),
            session_max_age_seconds=int(os.getenv("SESSION_MAX_AGE_SECONDS", "2592000")),
            public_origin=os.getenv("PUBLIC_ORIGIN") or None,
            openai_api_key=(os.getenv("OPENAI_API_KEY") or "").strip() or None,
            openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            model_timeout_seconds=float(os.getenv("MODEL_TIMEOUT_SECONDS", "20")),
            max_model_steps=min(max(int(os.getenv("MAX_MODEL_STEPS", "2")), 1), 2),
            rate_limit_per_minute=max(int(os.getenv("RATE_LIMIT_PER_MINUTE", "8")), 1),
            global_rate_limit_per_minute=max(int(os.getenv("GLOBAL_RATE_LIMIT_PER_MINUTE", "8")), 1),
            daily_request_limit=max(int(os.getenv("DAILY_REQUEST_LIMIT", "100")), 1),
            max_concurrent_requests=min(max(int(os.getenv("MAX_CONCURRENT_REQUESTS", "2")), 1), 8),
            running_ttl_seconds=max(int(os.getenv("RUNNING_TTL_SECONDS", "900")), 60),
            db_connect_timeout_seconds=min(max(int(os.getenv("DB_CONNECT_TIMEOUT_SECONDS", "5")), 1), 30),
            max_goal_chars=min(max(int(os.getenv("MAX_GOAL_CHARS", "500")), 100), 2000),
            max_history_items=min(max(int(os.getenv("MAX_HISTORY_ITEMS", "20")), 1), 50),
            port=int(os.getenv("PORT", "8000")),
        )
