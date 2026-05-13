"""Centralized URL / endpoint configuration for the Percy backend.

Before this module, ~5 different "own base URL" patterns existed across
`auth.py`, `email_service.py`, `team_envs_api.py`, `main.py`, etc., each with
its own env-var name and default fallback. That's a deploy-time landmine —
miss one and you get e.g. localhost links in production emails.

All sites that need to construct a URL pointing AT this backend, AT the
frontend, or AT a local LLM should pull from this module.
"""
from __future__ import annotations

import os


def _env_url(key: str, default: str) -> str:
    return os.environ.get(key, default).rstrip("/")


# ── Backend's own public base URL ─────────────────────────────────────────────
# Where this FastAPI server is reachable from the outside world.
# Used by: OAuth redirect URIs, share-link generation, emailed deep links into
# the API, server-side fetches that point at our own endpoints.
API_BASE_URL = _env_url("PERCY_API_BASE", "http://localhost:8000")


# ── Frontend public base URL ──────────────────────────────────────────────────
# Where the Studio UI is served. Used by: invitation emails, share links, OAuth
# success redirects, server-side render previews that need to embed UI links.
APP_BASE_URL = _env_url("PERCY_APP_URL", "http://localhost:5173")


# ── Google OAuth redirect target ──────────────────────────────────────────────
# Explicit override so the path can vary without forcing the whole API_BASE_URL
# to change for an OAuth-only deploy.
GOOGLE_REDIRECT_URI = os.environ.get(
    "GOOGLE_OAUTH_REDIRECT_URI",
    f"{API_BASE_URL}/api/auth/google/callback",
)


# ── Local LLM (LM Studio) base URL ────────────────────────────────────────────
# LM Studio's OpenAI-compatible REST server. Default is LM Studio's installer
# default. Used by: agent_chat, vision-critique fallback, agent debug paths.
LMSTUDIO_BASE_URL = _env_url("PERCY_LMSTUDIO_URL", "http://localhost:1234")


def lmstudio_chat_url() -> str:
    """Convenience helper for the chat-completions endpoint."""
    return f"{LMSTUDIO_BASE_URL}/v1/chat/completions"


def lmstudio_models_url() -> str:
    return f"{LMSTUDIO_BASE_URL}/v1/models"
