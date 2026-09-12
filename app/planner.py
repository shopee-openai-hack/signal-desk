from __future__ import annotations

import asyncio
import httpx
import json
import logging
from typing import Any

from openai import AsyncOpenAI
from pydantic import ValidationError

from .config import Settings
from .schemas import PlanDraft, PlanResult, PlanStep

logger = logging.getLogger(__name__)


class PlanGenerationError(RuntimeError):
    """An expected, user-safe model generation failure."""


def build_demo_plan(goal: str) -> PlanResult:
    """Return deterministic content so a new deployment is useful without a key."""
    return PlanResult(
        mode="demo",
        summary=f"先把「{goal}」縮小成今天能完成的一個可驗證切片。",
        first_step="用 10 分鐘寫下這個目標的完成定義，並圈出最小的下一步。",
        steps=[
            PlanStep(
                title="定義完成畫面",
                action=f"寫一句話描述「{goal}」在今天結束時看起來已完成的樣子。",
                why="清楚的完成定義能讓下一步變得可判斷。",
                done_when="一句話中包含可觀察的產出或結果。",
                minutes=10,
            ),
            PlanStep(
                title="切出最小行動",
                action="把目標拆成一個 25 分鐘內能交付、測試或分享的行動。",
                why="小切片比完整計畫更容易開始，也更快得到回饋。",
                done_when="手邊有一個明確檔案、草稿、電話或預約結果。",
                minutes=25,
            ),
            PlanStep(
                title="安排下一個檢查點",
                action="在行事曆留下一個 15 分鐘時段，檢查結果並決定下一步。",
                why="固定回看能讓進度持續，而不是停在一次性的靈感。",
                done_when="已建立時間點，並寫下要帶進檢查的問題。",
                minutes=15,
            ),
        ],
    )


SYSTEM_PROMPT = """你是小步，一個把目標轉成可執行下一步的繁體中文規劃助手。
只處理使用者提供的目標，產出務實、低摩擦、今天能開始的規劃。
請遵守：
- 只輸出 JSON，不要 markdown code fence。
- summary、first_step 與所有欄位使用繁體中文。
- steps 恰好提供 3 個步驟；每步 5 到 180 分鐘。
- 每步 action 必須是可觀察的動作，done_when 必須能判斷完成。
- 不要聲稱已替使用者執行任何外部操作，不要要求秘密或個資。
JSON 格式：
{"summary":"...","first_step":"...","steps":[{"title":"...","action":"...","why":"...","done_when":"...","minutes":25}]}"""


class Planner:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client = (
            AsyncOpenAI(
                api_key=settings.openai_api_key,
                timeout=settings.model_timeout_seconds,
                max_retries=0,
                http_client=httpx.AsyncClient(timeout=settings.model_timeout_seconds),
            )
            if settings.openai_api_key
            else None
        )

    async def close(self) -> None:
        if self._client:
            await self._client.close()

    async def generate(self, goal: str) -> PlanResult:
        async with asyncio.timeout(self.settings.model_timeout_seconds * self.settings.max_model_steps + 2):
            return await self._generate(goal)

    async def _generate(self, goal: str) -> PlanResult:
        if self._client is None:
            return build_demo_plan(goal)

        last_error: Exception | None = None
        for step_number in range(self.settings.max_model_steps):
            try:
                draft = await self._call_model(goal, correction=step_number > 0)
                return PlanResult(mode="live", **draft.model_dump())
            except (ValidationError, json.JSONDecodeError, KeyError, TypeError) as exc:
                last_error = exc
                logger.warning("model returned an invalid plan on step %s", step_number + 1)
            except Exception as exc:  # noqa: BLE001 - sanitize at the API boundary
                logger.warning("model request failed on step %s: %s", step_number + 1, type(exc).__name__)
                raise PlanGenerationError("AI 暫時無法產生規劃，請稍後再試。") from exc

        raise PlanGenerationError("AI 回傳的規劃格式不完整，請換個說法再試。") from last_error

    async def _call_model(self, goal: str, correction: bool) -> PlanDraft:
        assert self._client is not None
        prompt = (
            "請重新檢查 JSON 是否符合格式，保持內容簡短。"
            if correction
            else "請為以下目標建立一份可以今天開始的三步規劃："
        )
        response = await self._client.chat.completions.create(
            model=self.settings.openai_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"{prompt}\n\n目標：{goal}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1000,
        )
        content = response.choices[0].message.content
        if not content:
            raise ValueError("empty model response")
        payload: Any = json.loads(content)
        return PlanDraft.model_validate(payload)
