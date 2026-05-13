"""Team environments + refresh jobs API.

Architecture:
  - Studio API (App Runner) is the **dispatcher only** — it writes job rows
    to Postgres and pushes a message to the SQS onboard queue.
  - The ECS Fargate worker picks up the message, mounts an EFS volume at
    /efs/team-envs/{env_id}/venv, builds/restores the venv, runs the user's
    script, writes the result back to Postgres.
  - Frontend polls the result table for completion.

Message protocol on the shared SQS queue (`SQS_ONBOARD_QUEUE_URL`):
  Existing onboard messages (no `kind` key) keep working unchanged.
  New messages set `kind`:
    {"kind": "build_env",  "job_id": <eval-or-build-id>, "payload": {"env_id": "..."}}
    {"kind": "eval",       "job_id": <eval-id>,          "payload": {"env_id": "...", "script": "...", "context": {...}, "timeout_s": 60}}
    {"kind": "refresh_job","job_id": <run-id>,           "payload": {"job_id": "...", "project_id": "...", "env_id": "..."}}

Env path on EFS:  /efs/team-envs/{env_id}/venv
Each env has exactly one canonical location across all worker tasks.

For local dev (no SQS_ONBOARD_QUEUE_URL): the API falls back to in-process
subprocess execution. Same code paths, exposed for testing without AWS.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import threading

from app.backend.config import API_BASE_URL
import time
from pathlib import Path
from typing import Any

import boto3
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from . import auth, auth_db

log = logging.getLogger("percy.team_envs")
router = APIRouter(tags=["team_envs"])

# In production, this lives on EFS at /efs/team-envs (mounted by the worker).
# In dev or App Runner (which can't mount EFS), it's a local path that's only
# meaningful if you happen to be running the worker too.
TEAM_ENVS_ROOT = Path(os.environ.get("PERCY_TEAM_ENVS_DIR", "uploads/team_envs")).resolve()
TEAM_ENVS_ROOT.mkdir(parents=True, exist_ok=True)

SQS_QUEUE_URL = os.environ.get("SQS_ONBOARD_QUEUE_URL", "").strip()
_sqs = boto3.client("sqs") if SQS_QUEUE_URL else None


def _send_sqs(kind: str, job_id: str, payload: dict) -> None:
    """Push a job to the worker queue. No-op if SQS not configured."""
    if not _sqs:
        log.warning("SQS not configured — dispatch ignored: %s/%s", kind, job_id)
        return
    body = json.dumps({"kind": kind, "job_id": job_id, "payload": payload})
    _sqs.send_message(QueueUrl=SQS_QUEUE_URL, MessageBody=body)
    log.info("dispatched %s job %s", kind, job_id)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _require_org_admin(user: dict, org_id: str) -> None:
    org = auth_db.get_org(org_id)
    if not org:
        raise HTTPException(404, "Org not found")
    m = auth_db.get_membership(user["id"], org_id)
    if not m or m["role"] not in ("owner", "admin"):
        raise HTTPException(403, "Org admin required")


def _require_org_member(user: dict, org_id: str) -> None:
    if not auth_db.get_membership(user["id"], org_id):
        raise HTTPException(403, "Not a member of this org")


def _venv_python(venv_path: Path) -> Path:
    if os.name == "nt":
        return venv_path / "Scripts" / "python.exe"
    return venv_path / "bin" / "python"


# ── Env CRUD ─────────────────────────────────────────────────────────────────

class CreateEnvRequest(BaseModel):
    org_id: str
    name: str


@router.get("/api/orgs/{org_id}/team-envs")
def list_team_envs(request: Request, org_id: str):
    user = auth.require_user(request)
    _require_org_member(user, org_id)
    return {"envs": auth_db.list_org_team_envs(org_id)}


@router.post("/api/team-envs")
def create_team_env(request: Request, req: CreateEnvRequest):
    user = auth.require_user(request)
    _require_org_admin(user, req.org_id)
    return auth_db.create_team_env(req.org_id, name=req.name, created_by=user["id"])


@router.get("/api/team-envs/{env_id}")
def get_team_env(request: Request, env_id: str):
    user = auth.require_user(request)
    env = auth_db.get_team_env(env_id)
    if not env:
        raise HTTPException(404, "Env not found")
    _require_org_member(user, env["org_id"])
    return env


class UpdateEnvRequest(BaseModel):
    name: str | None = None
    requirements: str | None = None
    env_vars: dict | None = None
    package_index_url: str | None = None
    package_index_user: str | None = None
    package_index_token: str | None = None  # write-only; never returned


@router.patch("/api/team-envs/{env_id}")
def update_team_env(request: Request, env_id: str, req: UpdateEnvRequest):
    user = auth.require_user(request)
    env = auth_db.get_team_env(env_id)
    if not env:
        raise HTTPException(404, "Env not found")
    _require_org_admin(user, env["org_id"])
    fields: dict[str, Any] = {k: v for k, v in req.dict(exclude_unset=True).items() if v is not None}
    return auth_db.update_team_env(env_id, **fields)


@router.delete("/api/team-envs/{env_id}")
def delete_team_env(request: Request, env_id: str):
    user = auth.require_user(request)
    env = auth_db.get_team_env(env_id)
    if not env:
        raise HTTPException(404, "Env not found")
    _require_org_admin(user, env["org_id"])
    # Best effort local cleanup. EFS cleanup is the worker's job.
    if env.get("venv_path"):
        try: shutil.rmtree(env["venv_path"], ignore_errors=True)
        except Exception: pass
    auth_db.delete_team_env(env_id)
    return {"ok": True}


# ── Build (dispatched to worker) ────────────────────────────────────────────

@router.post("/api/team-envs/{env_id}/build")
def build_env(request: Request, env_id: str):
    user = auth.require_user(request)
    env = auth_db.get_team_env(env_id)
    if not env:
        raise HTTPException(404, "Env not found")
    _require_org_admin(user, env["org_id"])

    auth_db.update_team_env(env_id, status="building", last_build_log="(queued for worker)")
    if SQS_QUEUE_URL:
        _send_sqs("build_env", env_id, {"env_id": env_id})
    else:
        # Local dev fallback — run inline.
        threading.Thread(target=_local_build_env, args=(env_id,), daemon=True).start()
    return auth_db.get_team_env(env_id)


def _local_build_env(env_id: str) -> None:
    """Local dev only — same logic the worker runs, but in-process."""
    secret = auth_db.get_team_env_secret(env_id)
    if not secret: return
    env_dir = TEAM_ENVS_ROOT / env_id
    venv_path = env_dir / "venv"
    log_lines: list[str] = []
    try:
        env_dir.mkdir(parents=True, exist_ok=True)
        if not _venv_python(venv_path).exists():
            log_lines.append(f"creating venv at {venv_path}")
            subprocess.run([sys.executable, "-m", "venv", str(venv_path)], check=True, timeout=120,
                           capture_output=True, text=True)
        py = _venv_python(venv_path)
        subprocess.run([str(py), "-m", "pip", "install", "--upgrade", "pip"],
                       capture_output=True, text=True, timeout=120)
        reqs = (secret.get("requirements") or "").strip()
        if reqs:
            req_path = env_dir / "requirements.txt"
            req_path.write_text(reqs, encoding="utf-8")
            extra = os.environ.copy()
            idx = secret.get("package_index_url")
            if idx:
                user, tok = secret.get("package_index_user") or "", secret.get("package_index_token") or ""
                if user or tok:
                    from urllib.parse import urlparse, urlunparse
                    p = urlparse(idx)
                    full = urlunparse((p.scheme, f"{user}:{tok}@{p.netloc}", p.path, p.params, p.query, p.fragment))
                    extra["PIP_INDEX_URL"] = full
                else:
                    extra["PIP_INDEX_URL"] = idx
            r = subprocess.run([str(py), "-m", "pip", "install", "-r", str(req_path)],
                               capture_output=True, text=True, env=extra, timeout=600)
            log_lines.extend((r.stdout or "").splitlines()[-50:])
            if r.returncode != 0:
                log_lines.extend((r.stderr or "").splitlines()[-50:])
                auth_db.update_team_env(env_id, status="failed",
                                        last_build_log="\n".join(log_lines)[:50000],
                                        last_built_at=int(time.time()))
                return
        auth_db.update_team_env(env_id, status="ready", venv_path=str(venv_path),
                                last_build_log="\n".join(log_lines)[:50000],
                                last_built_at=int(time.time()))
    except Exception as e:
        log_lines.append(f"build error: {e}")
        auth_db.update_team_env(env_id, status="failed",
                                last_build_log="\n".join(log_lines)[:50000],
                                last_built_at=int(time.time()))


# ── Eval (dispatched, polled) ───────────────────────────────────────────────

class EvalRequest(BaseModel):
    script: str
    context: dict = {}
    timeout_s: int = 60


@router.post("/api/team-envs/{env_id}/eval")
def eval_in_env(request: Request, env_id: str, req: EvalRequest):
    """Dispatch a one-off eval. Returns an eval_id immediately; poll
    /api/team-envs/eval-results/{eval_id} for the result."""
    user = auth.require_user(request)
    env = auth_db.get_team_env(env_id)
    if not env:
        raise HTTPException(404, "Env not found")
    _require_org_member(user, env["org_id"])

    result = auth_db.create_eval_result(env_id, user_id=user["id"])
    eval_id = result["id"]
    payload = {
        "env_id": env_id,
        "script": req.script or "",
        "context": req.context or {},
        "timeout_s": max(1, min(int(req.timeout_s or 60), 300)),
    }
    if SQS_QUEUE_URL:
        _send_sqs("eval", eval_id, payload)
    else:
        threading.Thread(target=_local_eval, args=(eval_id, payload), daemon=True).start()
    return {"eval_id": eval_id, "status": "queued"}


@router.get("/api/team-envs/eval-results/{eval_id}")
def get_eval_result_endpoint(request: Request, eval_id: str):
    user = auth.require_user(request)
    r = auth_db.get_eval_result(eval_id)
    if not r:
        raise HTTPException(404, "Eval result not found")
    env = auth_db.get_team_env(r["env_id"])
    if env: _require_org_member(user, env["org_id"])
    return r


def _local_eval(eval_id: str, payload: dict) -> None:
    """Local dev fallback — same flow the worker runs."""
    auth_db.update_eval_result(eval_id, status="running")
    started = time.time()
    secret = auth_db.get_team_env_secret(payload["env_id"]) or {}
    py = sys.executable
    note = ""
    if secret.get("status") == "ready" and secret.get("venv_path"):
        vp = _venv_python(Path(secret["venv_path"]))
        if vp.exists(): py = str(vp)
        else: note = "venv missing on disk; using host python"
    else:
        note = f"env not ready ({secret.get('status')}); using host python"
    merged = os.environ.copy()
    for k, v in (secret.get("env_vars") or {}).items(): merged[str(k)] = str(v)
    for k, v in (payload.get("context") or {}).items(): merged[str(k)] = str(v)
    merged["PERCY_API_BASE"] = API_BASE_URL
    work = TEAM_ENVS_ROOT / "_evals" / eval_id
    work.mkdir(parents=True, exist_ok=True)
    (work / "script.py").write_text(payload.get("script", ""), encoding="utf-8")
    timeout = int(payload.get("timeout_s", 60))
    try:
        r = subprocess.run([py, str(work / "script.py")], capture_output=True, text=True,
                           env=merged, cwd=str(work), timeout=timeout)
        auth_db.update_eval_result(eval_id, status="success" if r.returncode == 0 else "failed",
                                   exit_code=r.returncode,
                                   stdout=(r.stdout or "")[-50000:],
                                   stderr=(r.stderr or "")[-50000:],
                                   elapsed_ms=int((time.time() - started) * 1000),
                                   note=note, finished_at=int(time.time()))
    except subprocess.TimeoutExpired:
        auth_db.update_eval_result(eval_id, status="failed", exit_code=-1,
                                   stderr=f"timed out after {timeout}s",
                                   elapsed_ms=int((time.time() - started) * 1000),
                                   note=note, finished_at=int(time.time()))
    finally:
        try: shutil.rmtree(work, ignore_errors=True)
        except Exception: pass


# ── Refresh jobs ─────────────────────────────────────────────────────────────

class CreateJobRequest(BaseModel):
    project_id: str
    schedule: str = "on_demand"
    env_id: str | None = None
    entry_point: str = "refresh.py"
    script_source: str = ""
    extra_env: dict = {}


@router.get("/api/projects/{project_id}/refresh-job")
def get_project_refresh_job(request: Request, project_id: str):
    user = auth.require_user(request)
    p = auth_db.get_project(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    _require_org_member(user, p["org_id"])
    return {"job": auth_db.get_project_refresh_job(project_id)}


@router.post("/api/refresh-jobs")
def create_refresh_job(request: Request, req: CreateJobRequest):
    user = auth.require_user(request)
    p = auth_db.get_project(req.project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    _require_org_member(user, p["org_id"])
    if req.env_id:
        env = auth_db.get_team_env(req.env_id)
        if not env or env["org_id"] != p["org_id"]:
            raise HTTPException(400, "env_id not in this project's org")
    existing = auth_db.get_project_refresh_job(req.project_id)
    if existing:
        auth_db.delete_refresh_job(existing["id"])
    return auth_db.create_refresh_job(
        req.project_id, schedule=req.schedule, env_id=req.env_id,
        entry_point=req.entry_point, script_source=req.script_source,
        extra_env=req.extra_env or {},
    )


@router.patch("/api/refresh-jobs/{job_id}")
def update_refresh_job(request: Request, job_id: str, req: dict):
    user = auth.require_user(request)
    job = auth_db.get_refresh_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    p = auth_db.get_project(job["project_id"])
    if not p:
        raise HTTPException(404, "Project not found")
    _require_org_member(user, p["org_id"])
    allowed = {"schedule", "env_id", "entry_point", "script_source", "extra_env", "enabled"}
    fields = {k: v for k, v in (req or {}).items() if k in allowed}
    return auth_db.update_refresh_job(job_id, **fields)


@router.delete("/api/refresh-jobs/{job_id}")
def delete_refresh_job(request: Request, job_id: str):
    user = auth.require_user(request)
    job = auth_db.get_refresh_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    p = auth_db.get_project(job["project_id"])
    _require_org_member(user, p["org_id"])
    auth_db.delete_refresh_job(job_id)
    return {"ok": True}


@router.get("/api/projects/{project_id}/refresh-runs")
def list_runs(request: Request, project_id: str):
    user = auth.require_user(request)
    p = auth_db.get_project(project_id)
    if not p:
        raise HTTPException(404, "Project not found")
    _require_org_member(user, p["org_id"])
    return {"runs": auth_db.list_project_refresh_runs(project_id)}


def dispatch_refresh_job(job_id: str) -> str | None:
    """Push a refresh-job execution to the worker queue. Returns the run_id."""
    job = auth_db.get_refresh_job(job_id)
    if not job: return None
    project = auth_db.get_project(job["project_id"])
    if not project: return None
    run = auth_db.create_refresh_run(job_id, job["project_id"])
    payload = {
        "job_id": job_id,
        "project_id": job["project_id"],
        "env_id": job.get("env_id"),
        "entry_point": job.get("entry_point"),
        "script_source": job.get("script_source"),
        "extra_env": job.get("extra_env") or {},
        "doc_id": project.get("doc_id"),
        "doc_source": project.get("doc_source"),
        "project_name": project.get("name"),
    }
    if SQS_QUEUE_URL:
        _send_sqs("refresh_job", run["id"], payload)
    else:
        threading.Thread(target=_local_refresh, args=(run["id"], job_id, payload), daemon=True).start()
    return run["id"]


def _local_refresh(run_id: str, job_id: str, payload: dict) -> None:
    """Local dev fallback for refresh job execution. Mirrors worker logic."""
    log_lines: list[str] = [f"refresh job {job_id} starting at {time.strftime('%Y-%m-%d %H:%M:%S')}"]
    try:
        py = sys.executable
        if payload.get("env_id"):
            env = auth_db.get_team_env_secret(payload["env_id"])
            if env and env.get("status") == "ready" and env.get("venv_path"):
                vp = _venv_python(Path(env["venv_path"]))
                if vp.exists(): py = str(vp); log_lines.append(f"using venv: {py}")
                else: log_lines.append(f"venv missing; using host python")
            else:
                log_lines.append(f"env not ready; using host python")
        merged = os.environ.copy()
        if payload.get("env_id"):
            env = auth_db.get_team_env_secret(payload["env_id"]) or {}
            for k, v in (env.get("env_vars") or {}).items(): merged[str(k)] = str(v)
        for k, v in (payload.get("extra_env") or {}).items(): merged[str(k)] = str(v)
        merged["PERCY_PROJECT_ID"] = payload.get("project_id") or ""
        merged["PERCY_DOC_ID"] = payload.get("doc_id") or ""
        merged["PERCY_API_BASE"] = API_BASE_URL
        work = TEAM_ENVS_ROOT / "_runs" / run_id
        work.mkdir(parents=True, exist_ok=True)
        script_path = work / payload.get("entry_point", "refresh.py")
        script_path.write_text(payload.get("script_source", ""), encoding="utf-8")
        log_lines.append(f"executing: {py} {script_path.name}")
        r = subprocess.run([py, str(script_path)], capture_output=True, text=True,
                           env=merged, cwd=str(work), timeout=300)
        log_lines.extend((r.stdout or "").splitlines()[-200:])
        if r.stderr:
            log_lines.append("--- stderr ---"); log_lines.extend((r.stderr or "").splitlines()[-100:])
        if r.returncode != 0:
            raise RuntimeError(f"script exited {r.returncode}")
        # Trigger build
        build_id = None
        try:
            build = auth_db.create_build(project_id=payload["project_id"], triggered_by=None,
                                         trigger="scheduled", formats=["pptx", "pdf"])
            build_id = build["id"]
            log_lines.append(f"triggered build {build_id}")
        except Exception as e:
            log_lines.append(f"build trigger failed: {e}")
        auth_db.update_refresh_run(run_id, status="success", finished_at=int(time.time()),
                                   log="\n".join(log_lines)[:200000], build_id=build_id)
        auth_db.mark_refresh_job_ran(job_id, status="success")
    except subprocess.TimeoutExpired:
        log_lines.append("ERROR: timed out after 300s")
        auth_db.update_refresh_run(run_id, status="failed", finished_at=int(time.time()),
                                   log="\n".join(log_lines)[:200000])
        auth_db.mark_refresh_job_ran(job_id, status="failed", error="timeout")
    except Exception as e:
        log_lines.append(f"ERROR: {e}")
        auth_db.update_refresh_run(run_id, status="failed", finished_at=int(time.time()),
                                   log="\n".join(log_lines)[:200000])
        auth_db.mark_refresh_job_ran(job_id, status="failed", error=str(e)[:1000])


@router.post("/api/refresh-jobs/{job_id}/run")
def run_refresh_job_now(request: Request, job_id: str):
    user = auth.require_user(request)
    job = auth_db.get_refresh_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    p = auth_db.get_project(job["project_id"])
    _require_org_member(user, p["org_id"])
    run_id = dispatch_refresh_job(job_id)
    return {"status": "queued", "run_id": run_id}


# ── Background scheduler ─────────────────────────────────────────────────────

_scheduler_thread: threading.Thread | None = None
_scheduler_stop = threading.Event()


def _scheduler_loop():
    log.info("refresh scheduler started")
    while not _scheduler_stop.is_set():
        try:
            for job in auth_db.list_due_refresh_jobs():
                log.info("scheduler: dispatching due job %s", job["id"])
                try:
                    dispatch_refresh_job(job["id"])
                    # Reset next_run_at right away so we don't re-dispatch
                    auth_db.mark_refresh_job_ran(job["id"], status="dispatched")
                except Exception as e:
                    log.exception("scheduler: dispatch %s failed: %s", job["id"], e)
        except Exception as e:
            log.exception("scheduler tick failed: %s", e)
        _scheduler_stop.wait(30)
    log.info("refresh scheduler stopped")


def start_scheduler() -> None:
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _scheduler_stop.clear()
    _scheduler_thread = threading.Thread(target=_scheduler_loop, name="percy-refresh-scheduler", daemon=True)
    _scheduler_thread.start()


def stop_scheduler() -> None:
    _scheduler_stop.set()
