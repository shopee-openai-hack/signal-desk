from __future__ import annotations

import asyncio
import threading
import time
from collections import defaultdict, deque


class InMemoryRateLimiter:
    """Small single-worker limiter suitable for the public PoC."""

    def __init__(self, max_requests: int, window_seconds: int = 60, max_buckets: int = 2048) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.max_buckets = max_buckets
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            bucket = self._buckets[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.max_requests:
                return False
            bucket.append(now)
            if len(self._buckets) > self.max_buckets:
                empty_keys = [item_key for item_key, item_bucket in self._buckets.items() if not item_bucket]
                for item_key in empty_keys:
                    self._buckets.pop(item_key, None)
                if len(self._buckets) > self.max_buckets:
                    oldest_keys = sorted(
                        self._buckets,
                        key=lambda item_key: self._buckets[item_key][-1],
                    )[: len(self._buckets) - self.max_buckets]
                    for item_key in oldest_keys:
                        self._buckets.pop(item_key, None)
            return True


class BoundedConcurrency:
    """Reject work briefly when all model slots are occupied."""

    def __init__(self, limit: int, acquire_timeout_seconds: float = 0.05) -> None:
        self._semaphore = asyncio.Semaphore(limit)
        self._acquire_timeout_seconds = acquire_timeout_seconds

    async def try_acquire(self) -> bool:
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=self._acquire_timeout_seconds)
            return True
        except TimeoutError:
            return False

    def release(self) -> None:
        self._semaphore.release()
