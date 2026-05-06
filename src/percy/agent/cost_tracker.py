"""Per-user / per-org LLM cost tracking and budget enforcement.

Every LLM call writes a row to ``llm_calls`` with:
  - actor (user_id, org_id)
  - model + provider
  - input/output tokens
  - estimated USD cost (using a built-in price sheet)
  - latency
  - source (chat / generate-deck / slide-explain / classify / etc.)

A ``BudgetEnforcer`` reads daily and monthly aggregates and rejects calls
that would exceed configured ceilings BEFORE the call goes out. This is the
hard cutoff — no soft warnings, refuse the request and tell the user.

Defaults (per-org):
  - daily   : 100,000 input + output tokens
  - monthly : 1,000,000 tokens
  - daily $ : $5.00
  - monthly : $50.00

Override per-org via ``set_org_limits(org_id, ...)`` or env vars
``PERCY_DEFAULT_DAILY_TOKEN_BUDGET`` / ``PERCY_DEFAULT_MONTHLY_USD_BUDGET``.

The price sheet covers Anthropic / Bedrock-Anthropic / OpenAI; LM Studio
and other local providers cost $0.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


_DEFAULT_DB_PATH = Path(os.environ.get("PERCY_AGENT_DB", "")) if os.environ.get("PERCY_AGENT_DB") \
    else Path(__file__).resolve().parent.parent.parent.parent / ".percy_agent.db"


SCHEMA = """
CREATE TABLE IF NOT EXISTS llm_calls (
    id              TEXT PRIMARY KEY,
    user_id         TEXT,
    org_id          TEXT,
    doc_id          TEXT,
    provider        TEXT NOT NULL,         -- 'anthropic' | 'bedrock' | 'openai' | 'lmstudio'
    model           TEXT NOT NULL,
    source          TEXT NOT NULL,         -- 'chat' | 'mode_router' | 'generate_deck' | 'slide_explain' | ...
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    cost_usd        REAL NOT NULL DEFAULT 0,
    latency_ms      INTEGER,
    action_id       TEXT,                  -- FK-ish into agent_actions
    cached          INTEGER DEFAULT 0,
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_org_day ON llm_calls(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_user    ON llm_calls(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_doc     ON llm_calls(doc_id);

CREATE TABLE IF NOT EXISTS llm_budgets (
    scope_id            TEXT NOT NULL,    -- org_id or 'global'
    scope_kind          TEXT NOT NULL,    -- 'org' | 'global'
    daily_token_budget  INTEGER,
    monthly_token_budget INTEGER,
    daily_usd_budget    REAL,
    monthly_usd_budget  REAL,
    updated_at          REAL NOT NULL,
    PRIMARY KEY (scope_kind, scope_id)
);
"""


# ── Price sheet (USD per 1k tokens). Conservative defaults. ────────────────


PRICES_PER_1K: dict[tuple[str, str], tuple[float, float]] = {
    # provider, model_substring  → (input_per_1k, output_per_1k)
    ("anthropic", "claude-opus-4"):       (0.015, 0.075),
    ("anthropic", "claude-sonnet-4"):     (0.003, 0.015),
    ("anthropic", "claude-haiku-4"):      (0.0008, 0.004),
    ("anthropic", "claude-3-5-haiku"):    (0.0008, 0.004),
    ("anthropic", "claude"):              (0.003, 0.015),     # generic fallback to Sonnet rate
    ("bedrock",   "anthropic.claude-opus-4"):  (0.015, 0.075),
    ("bedrock",   "anthropic.claude-sonnet-4"):(0.003, 0.015),
    ("bedrock",   "anthropic.claude-haiku-4"): (0.0008, 0.004),
    ("bedrock",   "anthropic.claude"):         (0.003, 0.015),
    ("bedrock",   "amazon.nova-pro"):     (0.0008, 0.0032),
    ("bedrock",   "amazon.nova-lite"):    (0.00006, 0.00024),
    ("bedrock",   "amazon.nova-micro"):   (0.000035, 0.00014),
    ("bedrock",   "meta.llama3-70b"):     (0.00099, 0.00099),
    ("openai",    "gpt-4o"):              (0.0025, 0.01),
    ("openai",    "gpt-4o-mini"):         (0.00015, 0.0006),
    ("openai",    "gpt-4"):               (0.03, 0.06),
    ("openai",    "gpt"):                 (0.0025, 0.01),     # generic
    ("lmstudio",  ""):                    (0.0, 0.0),
}


def estimate_cost(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate USD cost for a call. Returns 0 for local/unknown."""
    if provider == "lmstudio" or not model:
        return 0.0
    p, m = provider.lower(), model.lower()

    # Find best-matching price entry
    best: tuple[float, float] | None = None
    best_match_len = -1
    for (sp, sm), prices in PRICES_PER_1K.items():
        if sp != p:
            continue
        if sm and sm in m and len(sm) > best_match_len:
            best = prices
            best_match_len = len(sm)
        elif not sm and best is None:
            best = prices

    if best is None:
        return 0.0
    return (input_tokens / 1000) * best[0] + (output_tokens / 1000) * best[1]


# ── DB ──────────────────────────────────────────────────────────────────────


_INITIALIZED = False


def _conn(db_path: Path | None = None) -> sqlite3.Connection:
    p = db_path or _DEFAULT_DB_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(p), timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init_db(db_path: Path | None = None) -> None:
    global _INITIALIZED
    with _conn(db_path) as c:
        c.executescript(SCHEMA)
    _INITIALIZED = True


@contextmanager
def _ensured(db_path: Path | None = None):
    if not _INITIALIZED:
        init_db(db_path)
    c = _conn(db_path)
    try:
        yield c
    finally:
        c.close()


# ── Recording ───────────────────────────────────────────────────────────────


@dataclass(slots=True)
class CallRecord:
    user_id:       str | None
    org_id:        str | None
    doc_id:        str | None
    provider:      str
    model:         str
    source:        str
    input_tokens:  int
    output_tokens: int
    latency_ms:    int | None = None
    action_id:     str | None = None
    cached:        bool = False

    def cost(self) -> float:
        return estimate_cost(self.provider, self.model, self.input_tokens, self.output_tokens)


def record_call(rec: CallRecord, db_path: Path | None = None) -> str:
    cid = uuid.uuid4().hex
    cost = rec.cost()

    # ── Real-time $20 boundary alert ──
    # Compute the rolling 7-day account-wide LLM spend BEFORE this call and
    # AFTER. If we crossed a $20 boundary, fire an SNS alert. This is
    # complementary to AWS Budgets (which is delayed 24-48h and only tracks
    # AWS infra cost — not LLM provider spend).
    spend_before = _account_spend_last_n_days(7, db_path=db_path)
    spend_after = spend_before + cost

    with _ensured(db_path) as c:
        c.execute(
            """
            INSERT INTO llm_calls
            (id, user_id, org_id, doc_id, provider, model, source,
             input_tokens, output_tokens, cost_usd, latency_ms, action_id,
             cached, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (cid, rec.user_id, rec.org_id, rec.doc_id, rec.provider, rec.model,
             rec.source, rec.input_tokens, rec.output_tokens, cost, rec.latency_ms,
             rec.action_id, 1 if rec.cached else 0, time.time()),
        )

    # Fire alert if a $20 boundary was crossed (best-effort, swallows errors).
    try:
        before_band = int(spend_before // 20)
        after_band = int(spend_after // 20)
        if after_band > before_band:
            _emit_spend_alert(boundary_usd=after_band * 20,
                                spend_total=spend_after,
                                latest_call=rec, latest_cost=cost)
    except Exception as exc:
        log.warning("cost_tracker: spend-alert emission failed: %s", exc)

    return cid


def _account_spend_last_n_days(days: int, db_path: Path | None = None) -> float:
    cutoff = time.time() - days * 86400
    with _ensured(db_path) as c:
        row = c.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls WHERE created_at >= ?",
            (cutoff,),
        ).fetchone()
    return float(row[0] or 0.0)


def _emit_spend_alert(*, boundary_usd: int, spend_total: float,
                       latest_call: CallRecord, latest_cost: float) -> None:
    """Publish to PERCY_ALERTS_TOPIC_ARN via SNS, log otherwise."""
    msg = (
        f"Percy LLM spend crossed ${boundary_usd}. "
        f"Rolling 7-day total: ${spend_total:.2f}. "
        f"Latest call: provider={latest_call.provider}, model={latest_call.model}, "
        f"source={latest_call.source}, cost=${latest_cost:.4f}, "
        f"org={latest_call.org_id}, user={latest_call.user_id}."
    )
    log.warning("SPEND_ALERT: %s", msg)

    topic_arn = os.environ.get("PERCY_ALERTS_TOPIC_ARN")
    if not topic_arn:
        return
    try:
        import boto3
        sns = boto3.client("sns", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        sns.publish(
            TopicArn=topic_arn,
            Subject=f"[Percy] LLM spend crossed ${boundary_usd}",
            Message=msg,
        )
    except Exception as exc:
        log.warning("cost_tracker: SNS publish failed: %s", exc)


# ── Aggregations ────────────────────────────────────────────────────────────


def org_spend_today(org_id: str | None, db_path: Path | None = None) -> dict:
    """Total tokens + USD for an org since midnight UTC today."""
    if not org_id:
        return _zero_summary()
    cutoff = _midnight_utc()
    with _ensured(db_path) as c:
        row = c.execute(
            """SELECT
                COALESCE(SUM(input_tokens), 0) as i,
                COALESCE(SUM(output_tokens), 0) as o,
                COALESCE(SUM(cost_usd), 0) as c,
                COUNT(*) as n
               FROM llm_calls WHERE org_id = ? AND created_at >= ?""",
            (org_id, cutoff),
        ).fetchone()
    return {"input_tokens": row["i"], "output_tokens": row["o"],
            "total_tokens": row["i"] + row["o"], "cost_usd": row["c"], "calls": row["n"]}


def org_spend_this_month(org_id: str | None, db_path: Path | None = None) -> dict:
    if not org_id:
        return _zero_summary()
    cutoff = _start_of_month_utc()
    with _ensured(db_path) as c:
        row = c.execute(
            """SELECT
                COALESCE(SUM(input_tokens), 0) as i,
                COALESCE(SUM(output_tokens), 0) as o,
                COALESCE(SUM(cost_usd), 0) as c,
                COUNT(*) as n
               FROM llm_calls WHERE org_id = ? AND created_at >= ?""",
            (org_id, cutoff),
        ).fetchone()
    return {"input_tokens": row["i"], "output_tokens": row["o"],
            "total_tokens": row["i"] + row["o"], "cost_usd": row["c"], "calls": row["n"]}


def org_spend_summary(org_id: str | None, db_path: Path | None = None) -> dict:
    """Today + month + top expensive prompts + per-source breakdown."""
    today = org_spend_today(org_id, db_path)
    month = org_spend_this_month(org_id, db_path)
    by_source: dict[str, dict] = {}
    if org_id:
        cutoff = _start_of_month_utc()
        with _ensured(db_path) as c:
            rows = c.execute(
                """SELECT source,
                          COALESCE(SUM(input_tokens), 0) as i,
                          COALESCE(SUM(output_tokens), 0) as o,
                          COALESCE(SUM(cost_usd), 0) as c,
                          COUNT(*) as n
                   FROM llm_calls WHERE org_id = ? AND created_at >= ?
                   GROUP BY source""",
                (org_id, cutoff),
            ).fetchall()
        by_source = {
            r["source"]: {"input_tokens": r["i"], "output_tokens": r["o"],
                           "cost_usd": r["c"], "calls": r["n"]}
            for r in rows
        }
    return {"today": today, "month": month, "by_source": by_source}


def _zero_summary() -> dict:
    return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0, "calls": 0}


def _midnight_utc() -> float:
    import datetime as _dt
    now = _dt.datetime.now(_dt.UTC)
    return _dt.datetime(now.year, now.month, now.day, tzinfo=_dt.UTC).timestamp()


def _start_of_month_utc() -> float:
    import datetime as _dt
    now = _dt.datetime.now(_dt.UTC)
    return _dt.datetime(now.year, now.month, 1, tzinfo=_dt.UTC).timestamp()


# ── Budget enforcement ──────────────────────────────────────────────────────


@dataclass(slots=True)
class BudgetLimits:
    daily_tokens:   int = 100_000
    monthly_tokens: int = 1_000_000
    daily_usd:      float = 5.0
    monthly_usd:    float = 50.0


def get_org_limits(org_id: str | None, db_path: Path | None = None) -> BudgetLimits:
    """Resolve effective budget for an org. Falls back to global, then defaults."""
    daily_t   = int(os.environ.get("PERCY_DEFAULT_DAILY_TOKEN_BUDGET", "100000"))
    monthly_t = int(os.environ.get("PERCY_DEFAULT_MONTHLY_TOKEN_BUDGET", "1000000"))
    daily_u   = float(os.environ.get("PERCY_DEFAULT_DAILY_USD_BUDGET", "5"))
    monthly_u = float(os.environ.get("PERCY_DEFAULT_MONTHLY_USD_BUDGET", "50"))
    out = BudgetLimits(daily_t, monthly_t, daily_u, monthly_u)

    with _ensured(db_path) as c:
        # Global override
        for kind, sid in (("global", "global"), ("org", org_id or "")):
            if not sid:
                continue
            row = c.execute(
                "SELECT * FROM llm_budgets WHERE scope_kind = ? AND scope_id = ?",
                (kind, sid),
            ).fetchone()
            if row:
                out = BudgetLimits(
                    daily_tokens   = row["daily_token_budget"]   or out.daily_tokens,
                    monthly_tokens = row["monthly_token_budget"] or out.monthly_tokens,
                    daily_usd      = row["daily_usd_budget"]     or out.daily_usd,
                    monthly_usd    = row["monthly_usd_budget"]   or out.monthly_usd,
                )
    return out


def set_org_limits(
    org_id: str, *,
    daily_tokens: int | None = None,
    monthly_tokens: int | None = None,
    daily_usd: float | None = None,
    monthly_usd: float | None = None,
    db_path: Path | None = None,
) -> None:
    with _ensured(db_path) as c:
        c.execute(
            """
            INSERT INTO llm_budgets
            (scope_kind, scope_id, daily_token_budget, monthly_token_budget,
             daily_usd_budget, monthly_usd_budget, updated_at)
            VALUES ('org', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(scope_kind, scope_id) DO UPDATE SET
                daily_token_budget   = COALESCE(excluded.daily_token_budget,   llm_budgets.daily_token_budget),
                monthly_token_budget = COALESCE(excluded.monthly_token_budget, llm_budgets.monthly_token_budget),
                daily_usd_budget     = COALESCE(excluded.daily_usd_budget,     llm_budgets.daily_usd_budget),
                monthly_usd_budget   = COALESCE(excluded.monthly_usd_budget,   llm_budgets.monthly_usd_budget),
                updated_at = excluded.updated_at
            """,
            (org_id, daily_tokens, monthly_tokens, daily_usd, monthly_usd, time.time()),
        )


@dataclass(slots=True)
class BudgetCheck:
    allowed:        bool
    reason:         str | None = None
    headroom_today_usd:  float = 0.0
    headroom_month_usd:  float = 0.0
    headroom_today_tokens: int = 0
    headroom_month_tokens: int = 0


def check_budget(org_id: str | None, *, estimated_input_tokens: int = 1000,
                 estimated_output_tokens: int = 500, model: str = "claude-sonnet-4",
                 provider: str = "anthropic",
                 db_path: Path | None = None) -> BudgetCheck:
    """Decide whether to allow a call. Pre-flight check using estimates."""
    if not org_id:
        # No org context — allow but flag (frontline calls without auth)
        return BudgetCheck(allowed=True, reason="no_org_context")

    limits = get_org_limits(org_id, db_path)
    today = org_spend_today(org_id, db_path)
    month = org_spend_this_month(org_id, db_path)

    est_cost = estimate_cost(provider, model, estimated_input_tokens, estimated_output_tokens)
    est_tokens = estimated_input_tokens + estimated_output_tokens

    headroom_today_tokens = limits.daily_tokens - today["total_tokens"]
    headroom_month_tokens = limits.monthly_tokens - month["total_tokens"]
    headroom_today_usd    = limits.daily_usd - today["cost_usd"]
    headroom_month_usd    = limits.monthly_usd - month["cost_usd"]

    if today["total_tokens"] + est_tokens > limits.daily_tokens:
        return BudgetCheck(
            allowed=False,
            reason=f"daily token budget would be exceeded ({today['total_tokens']} + {est_tokens} > {limits.daily_tokens})",
            headroom_today_tokens=max(0, headroom_today_tokens),
            headroom_month_tokens=max(0, headroom_month_tokens),
            headroom_today_usd=max(0, headroom_today_usd),
            headroom_month_usd=max(0, headroom_month_usd),
        )
    if month["total_tokens"] + est_tokens > limits.monthly_tokens:
        return BudgetCheck(
            allowed=False,
            reason=f"monthly token budget would be exceeded ({month['total_tokens']} + {est_tokens} > {limits.monthly_tokens})",
            headroom_today_tokens=max(0, headroom_today_tokens),
            headroom_month_tokens=max(0, headroom_month_tokens),
            headroom_today_usd=max(0, headroom_today_usd),
            headroom_month_usd=max(0, headroom_month_usd),
        )
    if today["cost_usd"] + est_cost > limits.daily_usd:
        return BudgetCheck(
            allowed=False,
            reason=f"daily $ budget would be exceeded (${today['cost_usd']:.4f} + ${est_cost:.4f} > ${limits.daily_usd})",
            headroom_today_tokens=max(0, headroom_today_tokens),
            headroom_month_tokens=max(0, headroom_month_tokens),
            headroom_today_usd=max(0, headroom_today_usd),
            headroom_month_usd=max(0, headroom_month_usd),
        )
    if month["cost_usd"] + est_cost > limits.monthly_usd:
        return BudgetCheck(
            allowed=False,
            reason=f"monthly $ budget would be exceeded (${month['cost_usd']:.4f} + ${est_cost:.4f} > ${limits.monthly_usd})",
            headroom_today_tokens=max(0, headroom_today_tokens),
            headroom_month_tokens=max(0, headroom_month_tokens),
            headroom_today_usd=max(0, headroom_today_usd),
            headroom_month_usd=max(0, headroom_month_usd),
        )

    return BudgetCheck(
        allowed=True,
        headroom_today_tokens=headroom_today_tokens,
        headroom_month_tokens=headroom_month_tokens,
        headroom_today_usd=headroom_today_usd,
        headroom_month_usd=headroom_month_usd,
    )
