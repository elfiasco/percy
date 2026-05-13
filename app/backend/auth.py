"""Auth surface for the local backend.

- POST /api/auth/signup  — email + password (creates user + personal org)
- POST /api/auth/login   — email + password
- POST /api/auth/logout  — clear cookie + revoke session
- GET  /api/auth/me      — current user + orgs (or 401)
- GET  /api/auth/google/start    — initiate Google OAuth
- GET  /api/auth/google/callback — handle Google OAuth response

Sessions are JWTs in an HttpOnly Secure cookie. The JWT carries the session id;
revocation is enforced by checking the sessions table on every request.

Public endpoints (no auth required): everything under /api/auth/*, /openapi.json,
/docs, /redoc, the static-file mount, and a few legacy endpoints kept open for
the /dev tools (controlled via PERCY_PUBLIC_DEV=1).
"""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import time
import urllib.parse
import urllib.request
from typing import Any

import bcrypt
import jwt
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.base import BaseHTTPMiddleware

from . import auth_db

log = logging.getLogger("percy.auth")


# ── Config ────────────────────────────────────────────────────────────────────

JWT_SECRET = os.environ.get("PERCY_JWT_SECRET") or "dev-insecure-" + secrets.token_hex(16)
JWT_ALGO   = "HS256"
COOKIE_NAME = "percy_session"
COOKIE_TTL  = 60 * 60 * 24 * 30  # 30 days

from app.backend.config import GOOGLE_REDIRECT_URI  # noqa: F401 — re-exported for back-compat
GOOGLE_CLIENT_ID     = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")

# Routes that don't require auth (regex match)
_PUBLIC_PATTERNS = [
    re.compile(r"^/api/auth/"),
    re.compile(r"^/api/health$"),
    re.compile(r"^/api/agent/api-manifest$"),
    re.compile(r"^/api/showcase$"),       # unauthenticated marketing splash
    # Slide thumbnails for the showcase decks. The doc_ids are random 8-char
    # strings so they're not enumerable; only auth'd routes leak doc lists.
    re.compile(r"^/api/docs/[a-zA-Z0-9]+/slides/\d+/bridge\.png$"),
    re.compile(r"^/api/docs/[a-zA-Z0-9]+/slides/\d+/svg-data$"),
    re.compile(r"^/openapi\.json$"),
    re.compile(r"^/docs"),
    re.compile(r"^/redoc"),
    re.compile(r"^/$"),
    re.compile(r"^/assets/"),
    re.compile(r"^/favicon"),
    re.compile(r"^/static/"),
    re.compile(r"^/[A-Za-z0-9_\-]*$"),  # SPA root fallback (catch-all paths)
    re.compile(r"^/[A-Za-z0-9_\-]+\.(svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt)$"),  # root-level static assets
]

# When PERCY_PUBLIC_DEV=1, also allow /dev tooling endpoints to be hit unauthenticated
_DEV_PUBLIC = os.environ.get("PERCY_PUBLIC_DEV", "").lower() in ("1", "true", "yes")


def _is_public_path(path: str) -> bool:
    for pat in _PUBLIC_PATTERNS:
        if pat.match(path):
            return True
    if _DEV_PUBLIC and (path.startswith("/api/docs") or path.startswith("/api/workspace") or path.startswith("/api/upload") or path.startswith("/api/load-bundle") or path.startswith("/api/onboard") or path.startswith("/api/history") or path.startswith("/api/agent") or path.startswith("/api/mcp")):
        return True
    return False


# ── Password hashing ─────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


# ── JWT helpers ──────────────────────────────────────────────────────────────

def issue_jwt(session_id: str, user_id: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sid": session_id, "uid": user_id, "iat": now, "exp": now + COOKIE_TTL},
        JWT_SECRET,
        algorithm=JWT_ALGO,
    )


def decode_jwt(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.PyJWTError:
        return None


def set_session_cookie(response: Response, jwt_token: str) -> None:
    is_prod = os.environ.get("PERCY_ENV", "").lower() == "prod"
    response.set_cookie(
        key=COOKIE_NAME,
        value=jwt_token,
        max_age=COOKIE_TTL,
        httponly=True,
        secure=is_prod,           # HTTPS-only in prod
        samesite="lax",           # lax works for both same-origin and SSO redirects
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


# ── Middleware ───────────────────────────────────────────────────────────────

class AuthMiddleware(BaseHTTPMiddleware):
    """Reads the session cookie, looks up the user, and attaches request.state.user.
    Returns 401 for protected routes when no valid session is present."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        request.state.user = None
        request.state.session_id = None

        token = request.cookies.get(COOKIE_NAME)
        if token:
            payload = decode_jwt(token)
            if payload:
                sess = auth_db.get_session(payload["sid"])
                if sess:
                    user = auth_db.get_user(payload["uid"])
                    if user:
                        request.state.user = user
                        request.state.session_id = sess["id"]

        if request.state.user is None and not _is_public_path(path):
            return Response(
                content='{"detail":"Not authenticated"}',
                status_code=401,
                media_type="application/json",
            )

        return await call_next(request)


def require_user(request: Request) -> dict[str, Any]:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def require_admin(request: Request) -> dict[str, Any]:
    user = require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ── Helpers: org bootstrapping on first login ────────────────────────────────

def _bootstrap_orgs_for_user(user: dict[str, Any]) -> None:
    """Ensure the user has at least a personal org. For company emails, also
    auto-join (or create) a team org based on email domain."""
    email = user["email"]
    domain = auth_db.email_domain(email)

    # Personal org always
    auth_db.ensure_personal_org_for(user)

    # Team org if email is a non-personal domain
    if domain and not auth_db.domain_is_personal(email):
        team_existed = auth_db.get_org_by_domain(domain) is not None
        team = auth_db.ensure_team_org_for_domain(domain)
        # First user in a brand-new team is the owner; otherwise member
        role = "member" if team_existed else "owner"
        auth_db.add_membership(user["id"], team["id"], role)


# ── API surface ──────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


def _user_response(user: dict[str, Any]) -> dict[str, Any]:
    orgs = auth_db.list_user_orgs(user["id"])
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "avatar_url": user.get("avatar_url"),
        "is_admin": bool(user.get("is_admin")),
        "orgs": [
            {
                "id": o["id"],
                "name": o["name"],
                "slug": o["slug"],
                "kind": o["kind"],
                "domain": o.get("domain"),
                "role": o["role"],
            }
            for o in orgs
        ],
    }


@router.post("/signup")
def signup(req: SignupRequest, response: Response):
    if auth_db.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = auth_db.create_user(
        email=req.email,
        password_hash=hash_password(req.password),
        display_name=req.display_name or req.email.split("@", 1)[0],
    )
    _bootstrap_orgs_for_user(user)

    # Send verification email (non-blocking — failure doesn't prevent signup)
    try:
        from . import email_service
        verif = auth_db.create_email_verification(user["id"])
        email_service.send_verification_email(user["email"], user["display_name"], verif["token"])
    except Exception:
        pass

    sid = auth_db.create_session(user["id"])
    set_session_cookie(response, issue_jwt(sid, user["id"]))
    return _user_response(user)


@router.post("/login")
def login(req: LoginRequest, response: Response):
    user = auth_db.get_user_by_email(req.email)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Bootstrap org membership in case it's missing (e.g. legacy user)
    _bootstrap_orgs_for_user(user)

    sid = auth_db.create_session(user["id"])
    set_session_cookie(response, issue_jwt(sid, user["id"]))
    return _user_response(user)


@router.post("/logout")
def logout(request: Request, response: Response):
    sid = getattr(request.state, "session_id", None)
    if sid:
        auth_db.revoke_session(sid)
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    user = require_user(request)
    return _user_response(user)


@router.get("/collab-token")
def collab_token(request: Request):
    """Mint a short-lived JWT for the Yjs collab WebSocket relay.

    The studio sets `percy_session` as an HttpOnly cookie scoped to the
    studio's domain. The collab service runs on a different App Runner
    subdomain, so the cookie isn't sent on the WebSocket handshake. We
    issue a fresh, short-lived (15min) token here that the frontend can
    pass as a `?token=…` query parameter to the relay.

    The token reuses the user's CURRENT session id so the AuthMiddleware
    accepts it on the round-trip from the relay back to /api/auth/me. If
    we minted a token with a fake sid the middleware would reject it (no
    matching row in studio_sessions), the relay would 403 the WS handshake,
    and multiplayer would silently break.
    """
    user = require_user(request)
    sid = getattr(request.state, "session_id", None)
    if not sid:
        # Falls through to 401-ish: client should re-login. The AuthMiddleware
        # has already attached session_id when a real percy_session cookie
        # was sent, so this only fails on wholly-anonymous calls.
        raise HTTPException(status_code=401, detail="No active session")
    now = int(time.time())
    token = jwt.encode(
        {"sid": sid, "uid": user["id"], "iat": now, "exp": now + 15 * 60},
        JWT_SECRET,
        algorithm=JWT_ALGO,
    )
    return {"token": token}


class UpdateMeRequest(BaseModel):
    display_name: str | None = None
    avatar_url: str | None = None


@router.patch("/me")
def update_me(request: Request, req: UpdateMeRequest):
    user = require_user(request)
    fields: dict[str, Any] = {}
    if req.display_name is not None:
        name = req.display_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Display name cannot be empty")
        fields["display_name"] = name
    if req.avatar_url is not None:
        fields["avatar_url"] = req.avatar_url or None
    if fields:
        user = auth_db.update_user(user["id"], **fields) or user
    return _user_response(user)


class ChangePasswordRequest(BaseModel):
    current_password: str | None = None
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/change-password")
def change_password(request: Request, req: ChangePasswordRequest):
    user = require_user(request)
    if user.get("password_hash"):
        if not req.current_password or not verify_password(req.current_password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")
    auth_db.update_user(user["id"], password_hash=hash_password(req.new_password))
    return {"ok": True}


# ── Google OAuth ─────────────────────────────────────────────────────────────

_GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO  = "https://openidconnect.googleapis.com/v1/userinfo"


@router.get("/google/start")
def google_start(request: Request, response: Response, redirect: str = "/home"):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth not configured (set GOOGLE_OAUTH_CLIENT_ID)")
    state = secrets.token_urlsafe(24)
    # Store state and post-login redirect in a short-lived cookie
    response = Response(status_code=302)
    response.headers["Location"] = (
        _GOOGLE_AUTH_URL
        + "?"
        + urllib.parse.urlencode({
            "client_id":     GOOGLE_CLIENT_ID,
            "redirect_uri":  GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope":         "openid email profile",
            "state":         state,
            "access_type":   "online",
            "prompt":        "select_account",
        })
    )
    response.set_cookie("percy_oauth_state", f"{state}|{redirect}", max_age=600, httponly=True, samesite="lax", path="/")
    return response


@router.get("/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    if error:
        raise HTTPException(status_code=400, detail=f"Google OAuth error: {error}")
    cookie = request.cookies.get("percy_oauth_state", "")
    expected_state, _, redirect = cookie.partition("|")
    if not state or state != expected_state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    if not code:
        raise HTTPException(status_code=400, detail="Missing OAuth code")

    # Exchange code for token
    token_body = urllib.parse.urlencode({
        "code":          code,
        "client_id":     GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "grant_type":    "authorization_code",
    }).encode()
    req = urllib.request.Request(_GOOGLE_TOKEN_URL, data=token_body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            token_data = json.loads(r.read().decode())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google token exchange failed: {e}")

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="No access_token from Google")

    # Get user info
    info_req = urllib.request.Request(_GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(info_req, timeout=15) as r:
            info = json.loads(r.read().decode())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google userinfo failed: {e}")

    google_sub = info.get("sub")
    email      = info.get("email")
    name       = info.get("name") or (email.split("@", 1)[0] if email else "User")
    avatar     = info.get("picture")

    if not google_sub or not email:
        raise HTTPException(status_code=502, detail="Google response missing sub/email")

    # Find or create user
    user = auth_db.get_user_by_google_sub(google_sub) or auth_db.get_user_by_email(email)
    if not user:
        user = auth_db.create_user(
            email=email, google_sub=google_sub,
            display_name=name, avatar_url=avatar,
        )
    elif not user.get("google_sub"):
        # Link existing email-only account to this Google identity
        auth_db.update_user(user["id"], google_sub=google_sub, avatar_url=avatar or user.get("avatar_url"))
        user = auth_db.get_user(user["id"]) or user

    _bootstrap_orgs_for_user(user)

    # Issue our own session and redirect to the SPA
    sid = auth_db.create_session(user["id"])
    redirect = redirect or "/home"
    response = Response(status_code=302)
    response.headers["Location"] = redirect
    response.delete_cookie("percy_oauth_state", path="/")
    set_session_cookie(response, issue_jwt(sid, user["id"]))
    return response


# Allow the existing local-dev workflow to run unauthenticated when desired.
# We expose a tiny "promote me to admin" helper in dev-mode so the first user
# can use the /dev tools.
@router.post("/dev/grant-admin")
def dev_grant_admin(request: Request):
    if os.environ.get("PERCY_PUBLIC_DEV", "").lower() not in ("1", "true", "yes"):
        raise HTTPException(status_code=403, detail="Available only when PERCY_PUBLIC_DEV=1")
    user = require_user(request)
    auth_db.update_user(user["id"], is_admin=1)
    return {"ok": True}


# ── Password reset ────────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest):
    """Send a password reset email. Always returns 200 to avoid user enumeration."""
    from . import email_service
    user = auth_db.get_user_by_email(req.email)
    if user:
        reset = auth_db.create_password_reset(user["id"])
        email_service.send_password_reset_email(user["email"], user["display_name"], reset["token"])
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)

@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, response: Response):
    now = int(time.time())
    reset = auth_db.get_password_reset_by_token(req.token)
    if not reset or reset.get("used_at") or reset["expires_at"] < now:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    auth_db.update_user(reset["user_id"], password_hash=hash_password(req.new_password))
    auth_db.mark_password_reset_used(reset["id"])
    # Log them in
    user = auth_db.get_user(reset["user_id"])
    if user:
        sid = auth_db.create_session(user["id"])
        set_session_cookie(response, issue_jwt(sid, user["id"]))
        return _user_response(user)
    return {"ok": True}


# ── Email verification ────────────────────────────────────────────────────────

@router.post("/send-verification")
def send_verification(request: Request):
    """Send/resend email verification link to the current user."""
    from . import email_service
    user = require_user(request)
    if user.get("email_verified"):
        return {"ok": True, "message": "Email already verified"}
    verif = auth_db.create_email_verification(user["id"])
    email_service.send_verification_email(user["email"], user["display_name"], verif["token"])
    return {"ok": True, "message": "Verification email sent"}


@router.get("/verify-email")
def verify_email(token: str, response: Response):
    now = int(time.time())
    verif = auth_db.get_email_verification_by_token(token)
    if not verif or verif.get("used_at") or verif["expires_at"] < now:
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")
    auth_db.update_user(verif["user_id"], email_verified=1)
    auth_db.mark_email_verification_used(verif["id"])
    # Redirect to studio with a success flag
    response.status_code = 302
    response.headers["Location"] = "/home?verified=1"
    return response


# ── User settings ─────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings(request: Request):
    user = require_user(request)
    return auth_db.get_user_settings(user["id"])


class UpdateSettingsRequest(BaseModel):
    theme: str | None = None
    locale: str | None = None
    notifications: dict | None = None
    default_org_id: str | None = None
    panel_states: dict | None = None

@router.put("/settings")
def update_settings(request: Request, req: UpdateSettingsRequest):
    user = require_user(request)
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    return auth_db.upsert_user_settings(user["id"], **fields)


# ── Avatar upload ─────────────────────────────────────────────────────────────

@router.post("/avatar")
async def upload_avatar(request: Request, file: UploadFile = File(...)):
    """Upload a profile avatar. Stores as base64 data-URI (≤512KB)."""
    user = require_user(request)
    MAX = 512 * 1024
    data = await file.read()
    if len(data) > MAX:
        raise HTTPException(status_code=413, detail="Avatar must be ≤512 KB")
    import base64
    mime = file.content_type or "image/png"
    if mime not in ("image/png", "image/jpeg", "image/gif", "image/webp"):
        raise HTTPException(status_code=415, detail="Unsupported image type")
    data_uri = f"data:{mime};base64," + base64.b64encode(data).decode()
    auth_db.update_user(user["id"], avatar_url=data_uri)
    return {"avatar_url": data_uri}
