"""API key authentication middleware for Percy Cloud."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# Paths that do not require auth
_PUBLIC_PATHS = {"/api/cloud/health", "/docs", "/openapi.json", "/redoc"}


def _check_key(provided: str, stored: str) -> bool:
    """Constant-time comparison to prevent timing attacks."""
    return hmac.compare_digest(
        hashlib.sha256(provided.encode()).digest(),
        hashlib.sha256(stored.encode()).digest(),
    )


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """Require X-Percy-Api-Key header on all non-public endpoints."""

    def __init__(self, app, api_key: str) -> None:
        super().__init__(app)
        self._key = api_key

    async def dispatch(self, request: Request, call_next):
        if request.url.path in _PUBLIC_PATHS or request.url.path.startswith("/docs"):
            return await call_next(request)

        provided = request.headers.get("X-Percy-Api-Key", "")
        if not provided or not _check_key(provided, self._key):
            return Response(
                content='{"detail":"Unauthorized"}',
                status_code=401,
                media_type="application/json",
            )
        return await call_next(request)


def get_api_key() -> str | None:
    """Return the configured API key, or None if auth is disabled."""
    return os.environ.get("PERCY_API_KEY")
