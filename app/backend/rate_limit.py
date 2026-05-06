"""Token-bucket rate limiter for agent endpoints.

Protects:
  POST /api/agent/chat
  POST /api/agent/generate-deck
  POST /api/docs/{doc_id}/refresh
  POST /api/docs/{doc_id}/slides/{n}/explain
  POST /api/docs/{doc_id}/brand-check
  POST /api/agent/metric-consistency

Per-user (when authenticated) and per-IP (fallback for unauthenticated).
In-memory token buckets. For multi-instance deployments later, swap the
backing store for Redis/ElastiCache.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

from fastapi import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

log = logging.getLogger(__name__)


# Defaults: per-user 30 req/min on chat, 5 req/min on heavy ops.
PER_USER_LIMITS: dict[str, tuple[int, float]] = {
    # path_prefix → (capacity, refill_rate_per_sec)
    "/api/agent/chat":               (30, 0.5),     # 30 burst, 30/min steady
    "/api/agent/generate-deck":      (5,  0.05),    # 5 burst, 3/min steady — heavy
    "/api/agent/metric-consistency": (5,  0.05),
    "/api/docs/":                    (60, 1.0),     # general doc mutations: 60/min
}

PER_IP_FALLBACK: tuple[int, float] = (10, 0.1)  # unauthenticated: 10 burst, 6/min


@dataclass(slots=True)
class _Bucket:
    capacity: float
    rate: float
    tokens: float
    updated_at: float

    def take(self, n: float = 1.0, *, now: float | None = None) -> bool:
        if now is None:
            now = time.time()
        elapsed = now - self.updated_at
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.updated_at = now
        if self.tokens >= n:
            self.tokens -= n
            return True
        return False


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory token-bucket rate limiter for agent + doc-mutation endpoints."""

    def __init__(self, app):
        super().__init__(app)
        self._buckets: dict[str, _Bucket] = {}
        # Default: enabled in prod, disabled when PERCY_PUBLIC_DEV=1 (tests + dev).
        # Override explicitly with PERCY_RATE_LIMIT_ENABLED=1/0.
        explicit = os.environ.get("PERCY_RATE_LIMIT_ENABLED")
        if explicit is not None:
            self._enabled = explicit.lower() in ("1", "true", "yes")
        else:
            dev_mode = os.environ.get("PERCY_PUBLIC_DEV", "").lower() in ("1", "true", "yes")
            self._enabled = not dev_mode

    def _bucket(self, key: str, capacity: int, rate: float) -> _Bucket:
        b = self._buckets.get(key)
        if b is None:
            b = _Bucket(capacity=float(capacity), rate=float(rate),
                        tokens=float(capacity), updated_at=time.time())
            self._buckets[key] = b
        return b

    def _which_limit(self, path: str) -> tuple[int, float] | None:
        for prefix, lim in PER_USER_LIMITS.items():
            if path.startswith(prefix):
                return lim
        return None

    async def dispatch(self, request: Request, call_next):
        if not self._enabled:
            return await call_next(request)

        path = request.url.path
        limit = self._which_limit(path)
        if limit is None:
            return await call_next(request)

        capacity, rate = limit

        # Determine identity for the bucket key
        user = getattr(request.state, "user", None)
        if user and user.get("id"):
            key = f"user:{user['id']}:{path}"
        else:
            ip = (request.client.host if request.client else "unknown")
            key = f"ip:{ip}:{path}"
            capacity, rate = PER_IP_FALLBACK

        bucket = self._bucket(key, capacity, rate)
        if not bucket.take():
            log.warning("rate_limit: rejected %s (%s)", request.method, path)
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "rate_limit_exceeded",
                    "message": f"Too many requests for {path}. Limit: {capacity} burst, "
                               f"{rate * 60:.0f}/min steady.",
                    "retry_after_s": int(1.0 / rate) if rate > 0 else 60,
                },
                headers={"Retry-After": str(int(1.0 / rate) if rate > 0 else 60)},
            )

        return await call_next(request)


def install(app) -> None:
    app.add_middleware(RateLimitMiddleware)
    log.info("rate_limit: installed")
