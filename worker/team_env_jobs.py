"""Team-environment job handlers run inside the ECS Fargate worker.

Three message kinds dispatched by the studio API:

  * build_env    — pip-install requirements.txt into /efs/team-envs/{env_id}/venv
  * eval         — run a one-off script in an env's venv (Studio "Test now")
  * refresh_job  — run a saved refresh script + trigger a project build

Persistence:
  * Venv lives at TEAM_ENVS_DIR/{env_id}/venv  (TEAM_ENVS_DIR defaults to /efs/team-envs)
  * Job status / logs / outputs go to Postgres via psycopg2 (DB_HOST etc.)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

log = logging.getLogger("percy.worker.team_env")

TEAM_ENVS_DIR = Path(os.environ.get("PERCY_TEAM_ENVS_DIR", "/efs/team-envs")).resolve()
TEAM_ENVS_DIR.mkdir(parents=True, exist_ok=True)


# ── DB connection (shared with onboard_worker but lazy-init here) ──────────

_db_pool = None


def _init_db() -> bool:
    global _db_pool
    if _db_pool is not None: return True
    host = os.environ.get("DB_HOST")
    if not host: return False
    try:
        import psycopg2
        from psycopg2.pool import ThreadedConnectionPool
        _db_pool = ThreadedConnectionPool(
            minconn=1, maxconn=4,
            host=host, port=int(os.environ.get("DB_PORT", "5432")),
            dbname=os.environ.get("DB_NAME", "percy"),
            user=os.environ.get("DB_USER", "percy"),
            password=os.environ["DB_PASSWORD"],
        )
        return True
    except Exception as exc:
        log.exception("DB init failed: %s", exc)
        return False


@contextmanager
def _conn() -> Generator:
    if _db_pool is None and not _init_db():
        raise RuntimeError("no DB connection available")
    c = _db_pool.getconn()
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        _db_pool.putconn(c)


# ── DB helpers ──────────────────────────────────────────────────────────────

def _get_team_env(env_id: str) -> dict | None:
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(
                "SELECT id, org_id, name, requirements, env_vars, package_index_url, "
                "package_index_user, package_index_token, status FROM studio_team_envs WHERE id = %s",
                (env_id,),
            )
            r = cur.fetchone()
    if not r: return None
    keys = ["id", "org_id", "name", "requirements", "env_vars", "package_index_url",
            "package_index_user", "package_index_token", "status"]
    out = dict(zip(keys, r))
    try: out["env_vars"] = json.loads(out["env_vars"]) if out["env_vars"] else {}
    except Exception: out["env_vars"] = {}
    return out


def _update_team_env(env_id: str, **fields) -> None:
    if not fields: return
    fields["updated_at"] = int(time.time())
    cols = ", ".join(f"{k} = %s" for k in fields)
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(f"UPDATE studio_team_envs SET {cols} WHERE id = %s",
                        (*fields.values(), env_id))


def _update_eval_result(eval_id: str, **fields) -> None:
    if not fields: return
    cols = ", ".join(f"{k} = %s" for k in fields)
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(f"UPDATE studio_eval_results SET {cols} WHERE id = %s",
                        (*fields.values(), eval_id))


def _update_refresh_run(run_id: str, **fields) -> None:
    if not fields: return
    cols = ", ".join(f"{k} = %s" for k in fields)
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(f"UPDATE studio_refresh_runs SET {cols} WHERE id = %s",
                        (*fields.values(), run_id))


def _mark_refresh_job_ran(job_id: str, status: str, error: str | None = None) -> None:
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(
                "SELECT schedule FROM studio_refresh_jobs WHERE id = %s",
                (job_id,),
            )
            row = cur.fetchone()
            schedule = row[0] if row else None
            intervals = {"hourly": 3600, "daily": 86400, "weekly": 604800, "monthly": 2592000}
            next_run = int(time.time()) + intervals[schedule] if schedule in intervals else None
            cur.execute(
                "UPDATE studio_refresh_jobs SET last_run_at = %s, last_status = %s, "
                "last_error = %s, next_run_at = %s, updated_at = %s WHERE id = %s",
                (int(time.time()), status, error, next_run, int(time.time()), job_id),
            )


def _create_build(project_id: str, formats: list[str]) -> str:
    """Create a queued build row; the build itself is processed elsewhere."""
    import secrets
    bid = "bld_" + secrets.token_urlsafe(12)
    with _conn() as c:
        with c.cursor() as cur:
            cur.execute(
                "INSERT INTO studio_builds (id, project_id, triggered_by, trigger, status, "
                "formats, started_at) VALUES (%s, %s, NULL, 'scheduled', 'queued', %s, %s)",
                (bid, project_id, json.dumps(formats), int(time.time())),
            )
    return bid


# ── venv build / restore ────────────────────────────────────────────────────

def _venv_python(venv: Path) -> Path:
    return (venv / "Scripts" / "python.exe") if os.name == "nt" else (venv / "bin" / "python")


def _build_venv(env: dict, log_lines: list[str]) -> Path:
    """Create venv at TEAM_ENVS_DIR/{env_id}/venv and pip install requirements."""
    env_id = env["id"]
    env_dir = TEAM_ENVS_DIR / env_id
    env_dir.mkdir(parents=True, exist_ok=True)
    venv = env_dir / "venv"
    if not _venv_python(venv).exists():
        log_lines.append(f"creating venv at {venv}")
        subprocess.run([sys.executable, "-m", "venv", str(venv)],
                       check=True, capture_output=True, text=True, timeout=180)
    py = _venv_python(venv)
    subprocess.run([str(py), "-m", "pip", "install", "--upgrade", "pip"],
                   capture_output=True, text=True, timeout=120)
    reqs = (env.get("requirements") or "").strip()
    if reqs:
        req_path = env_dir / "requirements.txt"
        req_path.write_text(reqs, encoding="utf-8")
        sub_env = os.environ.copy()
        idx = env.get("package_index_url")
        if idx:
            user = env.get("package_index_user") or ""
            tok = env.get("package_index_token") or ""
            if user or tok:
                from urllib.parse import urlparse, urlunparse
                p = urlparse(idx)
                full = urlunparse((p.scheme, f"{user}:{tok}@{p.netloc}", p.path, p.params, p.query, p.fragment))
                sub_env["PIP_INDEX_URL"] = full
            else:
                sub_env["PIP_INDEX_URL"] = idx
        log_lines.append(f"pip install -r requirements.txt ({len(reqs.splitlines())} lines)")
        r = subprocess.run([str(py), "-m", "pip", "install", "-r", str(req_path)],
                           capture_output=True, text=True, env=sub_env, timeout=900)
        log_lines.extend((r.stdout or "").splitlines()[-50:])
        if r.returncode != 0:
            log_lines.extend((r.stderr or "").splitlines()[-50:])
            raise RuntimeError(f"pip install failed (exit {r.returncode})")
    return venv


def _ensure_venv_ready(env: dict, log_lines: list[str]) -> Path | None:
    """If the venv is missing on EFS, rebuild from requirements. Returns the
    venv python path, or None if the env has no install (host python)."""
    venv = TEAM_ENVS_DIR / env["id"] / "venv"
    py = _venv_python(venv)
    if py.exists():
        return py
    log_lines.append(f"venv missing at {venv}; rebuilding")
    _build_venv(env, log_lines)
    return _venv_python(venv) if _venv_python(venv).exists() else None


# ── Handlers ────────────────────────────────────────────────────────────────

def _handle_build_env(job_id: str, payload: dict) -> None:
    env_id = payload.get("env_id") or job_id
    env = _get_team_env(env_id)
    if not env:
        log.warning("build_env: env %s not found", env_id)
        return
    _update_team_env(env_id, status="building", last_build_log="(worker building...)")
    log_lines: list[str] = [f"build started at {time.strftime('%Y-%m-%d %H:%M:%S')}"]
    try:
        venv = _build_venv(env, log_lines)
        _update_team_env(env_id, status="ready", venv_path=str(venv),
                         last_build_log="\n".join(log_lines)[:50000],
                         last_built_at=int(time.time()))
        log.info("build_env %s ready at %s", env_id, venv)
    except subprocess.TimeoutExpired:
        log_lines.append("ERROR: build timed out")
        _update_team_env(env_id, status="failed",
                         last_build_log="\n".join(log_lines)[:50000],
                         last_built_at=int(time.time()))
    except Exception as exc:
        log.exception("build_env %s failed: %s", env_id, exc)
        log_lines.append(f"ERROR: {exc}")
        _update_team_env(env_id, status="failed",
                         last_build_log="\n".join(log_lines)[:50000],
                         last_built_at=int(time.time()))


def _handle_eval(eval_id: str, payload: dict) -> None:
    env_id = payload.get("env_id")
    env = _get_team_env(env_id) if env_id else None
    if not env:
        _update_eval_result(eval_id, status="failed", exit_code=-1,
                            stderr=f"env {env_id} not found",
                            finished_at=int(time.time()))
        return
    _update_eval_result(eval_id, status="running")
    started = time.time()
    log_lines: list[str] = []
    note = ""
    try:
        py = _ensure_venv_ready(env, log_lines)
        if not py:
            py = Path(sys.executable)
            note = "no venv; using host python"
        merged = os.environ.copy()
        for k, v in (env.get("env_vars") or {}).items(): merged[str(k)] = str(v)
        for k, v in (payload.get("context") or {}).items(): merged[str(k)] = str(v)
        merged.setdefault("PERCY_API_BASE", os.environ.get("PERCY_API_URL", ""))
        work = TEAM_ENVS_DIR / "_evals" / eval_id
        work.mkdir(parents=True, exist_ok=True)
        (work / "script.py").write_text(payload.get("script", ""), encoding="utf-8")
        timeout = max(1, min(int(payload.get("timeout_s", 60)), 300))
        r = subprocess.run([str(py), str(work / "script.py")],
                           capture_output=True, text=True, env=merged,
                           cwd=str(work), timeout=timeout)
        _update_eval_result(eval_id,
                            status="success" if r.returncode == 0 else "failed",
                            exit_code=r.returncode,
                            stdout=(r.stdout or "")[-50000:],
                            stderr=(r.stderr or "")[-50000:],
                            elapsed_ms=int((time.time() - started) * 1000),
                            note=note + ("\n" + "\n".join(log_lines) if log_lines else ""),
                            finished_at=int(time.time()))
        try: shutil.rmtree(work, ignore_errors=True)
        except Exception: pass
    except subprocess.TimeoutExpired:
        _update_eval_result(eval_id, status="failed", exit_code=-1,
                            stderr=f"timed out", note=note,
                            elapsed_ms=int((time.time() - started) * 1000),
                            finished_at=int(time.time()))
    except Exception as exc:
        log.exception("eval %s failed: %s", eval_id, exc)
        _update_eval_result(eval_id, status="failed", exit_code=-1,
                            stderr=str(exc)[:5000], note=note,
                            elapsed_ms=int((time.time() - started) * 1000),
                            finished_at=int(time.time()))


def _handle_refresh_job(run_id: str, payload: dict) -> None:
    job_id = payload.get("job_id")
    project_id = payload.get("project_id")
    log_lines: list[str] = [f"refresh run started at {time.strftime('%Y-%m-%d %H:%M:%S')}"]
    try:
        env_id = payload.get("env_id")
        py = Path(sys.executable)
        if env_id:
            env = _get_team_env(env_id)
            if env:
                p = _ensure_venv_ready(env, log_lines)
                if p: py = p; log_lines.append(f"using venv: {py}")
            else:
                log_lines.append(f"env {env_id} not found; using host python")
        merged = os.environ.copy()
        if env_id:
            env_full = _get_team_env(env_id) or {}
            for k, v in (env_full.get("env_vars") or {}).items(): merged[str(k)] = str(v)
        for k, v in (payload.get("extra_env") or {}).items(): merged[str(k)] = str(v)
        merged["PERCY_PROJECT_ID"] = project_id or ""
        merged["PERCY_DOC_ID"] = payload.get("doc_id") or ""
        merged["PERCY_API_BASE"] = os.environ.get("PERCY_API_URL", "")
        work = TEAM_ENVS_DIR / "_runs" / run_id
        work.mkdir(parents=True, exist_ok=True)
        sp = work / (payload.get("entry_point") or "refresh.py")
        sp.write_text(payload.get("script_source") or "", encoding="utf-8")
        log_lines.append(f"executing: {py} {sp.name}")
        r = subprocess.run([str(py), str(sp)], capture_output=True, text=True,
                           env=merged, cwd=str(work), timeout=300)
        log_lines.extend((r.stdout or "").splitlines()[-200:])
        if r.stderr:
            log_lines.append("--- stderr ---")
            log_lines.extend((r.stderr or "").splitlines()[-100:])
        if r.returncode != 0:
            raise RuntimeError(f"script exited {r.returncode}")
        build_id = None
        try:
            build_id = _create_build(project_id, ["pptx", "pdf"])
            log_lines.append(f"queued build {build_id}")
        except Exception as e:
            log_lines.append(f"build queue failed: {e}")
        _update_refresh_run(run_id, status="success",
                            finished_at=int(time.time()),
                            log="\n".join(log_lines)[:200000],
                            build_id=build_id)
        if job_id: _mark_refresh_job_ran(job_id, "success")
        try: shutil.rmtree(work, ignore_errors=True)
        except Exception: pass
    except subprocess.TimeoutExpired:
        log_lines.append("ERROR: timed out after 300s")
        _update_refresh_run(run_id, status="failed",
                            finished_at=int(time.time()),
                            log="\n".join(log_lines)[:200000])
        if job_id: _mark_refresh_job_ran(job_id, "failed", "timeout")
    except Exception as exc:
        log.exception("refresh run %s failed: %s", run_id, exc)
        log_lines.append(f"ERROR: {exc}")
        _update_refresh_run(run_id, status="failed",
                            finished_at=int(time.time()),
                            log="\n".join(log_lines)[:200000])
        if job_id: _mark_refresh_job_ran(job_id, "failed", str(exc)[:1000])


# ── Public dispatch ─────────────────────────────────────────────────────────

_HANDLERS = {
    "build_env":   _handle_build_env,
    "eval":        _handle_eval,
    "refresh_job": _handle_refresh_job,
}


def handle(kind: str, job_id: str, payload: dict) -> None:
    fn = _HANDLERS.get(kind)
    if not fn:
        log.warning("unknown team-env kind %r", kind)
        return
    fn(job_id, payload)
