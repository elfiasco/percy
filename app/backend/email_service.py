"""Email sending service for Percy Studio.

Supports:
  - SMTP (configurable via env vars)
  - Console fallback (dev mode — prints email to stdout)

Environment variables:
  PERCY_EMAIL_FROM      — sender address (default: noreply@percy.app)
  SMTP_HOST             — SMTP server host
  SMTP_PORT             — SMTP server port (default: 587)
  SMTP_USER             — SMTP username
  SMTP_PASSWORD         — SMTP password
  SMTP_USE_TLS          — "1" to use STARTTLS (default: "1")
  PERCY_APP_URL         — base URL for links in emails (default: http://localhost:5173)
"""
from __future__ import annotations

import logging
import os
import smtplib
import textwrap
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

log = logging.getLogger("percy.email")

from app.backend.config import APP_BASE_URL as APP_URL  # noqa: F401 — re-exported
FROM_ADDR   = os.environ.get("PERCY_EMAIL_FROM", "noreply@percy.app")
SMTP_HOST   = os.environ.get("SMTP_HOST", "")
SMTP_PORT   = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER   = os.environ.get("SMTP_USER", "")
SMTP_PASS   = os.environ.get("SMTP_PASSWORD", "")
SMTP_TLS    = os.environ.get("SMTP_USE_TLS", "1").lower() not in ("0", "false", "no")


def _send(to: str, subject: str, html: str, text: str) -> None:
    if not SMTP_HOST:
        # Dev fallback: log to console
        log.info("📧 [EMAIL] To: %s | Subject: %s\n%s", to, subject, text)
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = FROM_ADDR
    msg["To"]      = to
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
            if SMTP_TLS:
                s.starttls()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(FROM_ADDR, [to], msg.as_string())
        log.info("Email sent to %s: %s", to, subject)
    except Exception as e:
        log.error("Failed to send email to %s: %s", to, e)


def send_verification_email(to_email: str, display_name: str, token: str) -> None:
    link = f"{APP_URL}/verify-email?token={token}"
    subject = "Verify your Percy account"
    text = textwrap.dedent(f"""
        Hi {display_name},

        Please verify your email address by clicking the link below:
        {link}

        This link expires in 24 hours. If you didn't create a Percy account, ignore this email.

        — The Percy Team
    """).strip()
    html = f"""
    <html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a2e">Verify your email</h2>
      <p>Hi {display_name},</p>
      <p>Please verify your email address to activate your Percy account.</p>
      <a href="{link}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Verify Email</a>
      <p style="margin-top:24px;font-size:13px;color:#666">Link expires in 24 hours. If you didn't create a Percy account, ignore this email.</p>
    </body></html>
    """
    _send(to_email, subject, html, text)


def send_password_reset_email(to_email: str, display_name: str, token: str) -> None:
    link = f"{APP_URL}/reset-password?token={token}"
    subject = "Reset your Percy password"
    text = textwrap.dedent(f"""
        Hi {display_name},

        You requested a password reset. Click the link below to set a new password:
        {link}

        This link expires in 1 hour. If you didn't request this, ignore this email.

        — The Percy Team
    """).strip()
    html = f"""
    <html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a2e">Reset your password</h2>
      <p>Hi {display_name},</p>
      <p>You requested a password reset for your Percy account.</p>
      <a href="{link}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Reset Password</a>
      <p style="margin-top:24px;font-size:13px;color:#666">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
    </body></html>
    """
    _send(to_email, subject, html, text)


def send_org_invite_email(to_email: str, inviter_name: str, org_name: str, accept_url: str) -> None:
    subject = f"You're invited to join {org_name} on Percy"
    text = textwrap.dedent(f"""
        Hi,

        {inviter_name} has invited you to join {org_name} on Percy.

        Accept the invitation: {accept_url}

        — The Percy Team
    """).strip()
    html = f"""
    <html><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a2e">You're invited to Percy</h2>
      <p><strong>{inviter_name}</strong> has invited you to join <strong>{org_name}</strong> on Percy.</p>
      <a href="{accept_url}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Accept Invitation</a>
      <p style="margin-top:24px;font-size:13px;color:#666">If you don't want to join, ignore this email.</p>
    </body></html>
    """
    _send(to_email, subject, html, text)
