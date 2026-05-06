"""Team environments + refresh jobs API.

Demo-grade implementation:
  - Each team env is a per-org venv built on the host filesystem under
    ``uploads/team_envs/{env_id}/venv``. We pip-install the team's
    requirements.txt (with optional Artifactory creds) into that venv.
  - Refresh jobs run a team-supplied python script with the env's venv
    + the team's env_vars + per-job extra_env injected as os.environ.
    The script's job is to mutate Percy data (e.g., re-fetch from a DB
    and update slide content), then we trigger a project build at the end.

Future improvements (not in v1):
  - Run user code in an isolated container (per-team ECR image), not on
    the host. The `package_index_token` is currently stored in plaintext
    in the DB; production should use AWS Secrets Manager.
  - BYOI (bring-your-own-image) tier: allow customers to push pre-built
    images via cross-account ECR role.
  - Real cron expressions; currently only fixed-period intervals.
  - Per-job timeout enforcement (currently 5min wallclock cap).
  - Background-process pool / queue; current scheduler runs in the API
    process which is fine for demo but doesn't survive a restart cleanly.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from . import auth, auth_db

log = logging.getLogger("percy.team_envs")
router = APIRouter(tags=["team_envs"])

# Where venvs live on disk. One subdir per env id.
TEAM_ENVS_ROOT = Path(os.environ.get("PERCY_TEAM_ENVS_DIR", "uploads/team_envs")).resolve()
TEAM_ENVS_ROOT.mkdir(parents=True, exist_ok=True)


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
    # Also nuke the on-disk venv
    if env.get("venv_path"):
        try: shutil.rmtree(env["venv_path"], ignore_errors=True)
        except Exception: pass
    auth_db.delete_team_env(env_id)
    return {"ok": True}


# ── Build (pip install) ─────────────────────────────────────────────────────

def _build_env_sync(env_id: str) -> dict:
    """Create venv + pip install. Synchronous; called from a thread."""
    secret = auth_db.get_team_env_secret(env_id)
    if not secret:
        return {"status": "failed", "log": "env not found"}

    env_dir = TEAM_ENVS_ROOT / env_id
    env_dir.mkdir(parents=True, exist_ok=True)
    venv_path = env_dir / "venv"
    log_lines: list[str] = []

    def _emit(s: str) -> None:
        log_lines.append(s)
        log.info("[env %s] %s", env_id, s)

    try:
        # 1. Create venv (idempotent — only if missing)
        if not _venv_python(venv_path).exists():
            _emit(f"creating venv at {venv_path}")
            subprocess.run([sys.executable, "-m", "venv", str(venv_path)],
                           check=True, capture_output=True, text=True, timeout=120)

        py = _venv_python(venv_path)

        # 2. Upgrade pip (best effort)
        subprocess.run([str(py), "-m", "pip", "install", "--upgrade", "pip"],
                       capture_output=True, text=True, timeout=120)

        # 3. Install requirements, if any
        reqs = (secret.get("requirements") or "").strip()
        if reqs:
            req_path = env_dir / "requirements.txt"
            req_path.write_text(reqs, encoding="utf-8")
            cmd = [str(py), "-m", "pip", "install", "-r", str(req_path)]
            extra_env = os.environ.copy()
            idx_url = secret.get("package_index_url")
            if idx_url:
                # pip honors PIP_INDEX_URL; if user/token set, embed in URL.
                user = secret.get("package_index_user") or ""
                token = secret.get("package_index_token") or ""
                if user or token:
                    # Inject creds into the URL: https://user:token@host/...
                    from urllib.parse import urlparse, urlunparse
                    p = urlparse(idx_url)
                    netloc = f"{user}:{token}@{p.netloc}" if (user or token) else p.netloc
                    full = urlunparse((p.scheme, netloc, p.path, p.params, p.query, p.fragment))
                    extra_env["PIP_INDEX_URL"] = full
                else:
                    extra_env["PIP_INDEX_URL"] = idx_url
            _emit(f"pip install -r requirements.txt ({len(reqs.splitlines())} lines)")
            r = subprocess.run(cmd, capture_output=True, text=True, env=extra_env, timeout=600)
            log_lines.extend((r.stdout or "").splitlines()[-50:])
            if r.returncode != 0:
                log_lines.extend((r.stderr or "").splitlines()[-50:])
                return {"status": "failed", "log": "\n".join(log_lines), "venv_path": str(venv_path)}

        return {"status": "ready", "log": "\n".join(log_lines), "venv_path": str(venv_path)}
    except subprocess.TimeoutExpired as e:
        log_lines.append(f"timeout: {e}")
        return {"status": "failed", "log": "\n".join(log_lines)}
    except Exception as e:
        log_lines.append(f"build error: {e}")
        return {"status": "failed", "log": "\n".join(log_lines)}


@router.post("/api/team-envs/{env_id}/build")
def build_env(request: Request, env_id: str):
    user = auth.require_user(request)
    env = auth_db.get_team_env(env_id)
    if not env:
        raise HTTPException(404, "Env not found")
    _require_org_admin(user, env["org_id"])

    auth_db.update_team_env(env_id, status="building", last_build_log="(building...)")
    # Synchronous for demo simplicity. ~30-180s typical.
    result = _build_env_sync(env_id)
    auth_db.update_team_env(
        env_id,
        status=result["status"],
        last_build_log=result.get("log", "")[:50000],
        last_built_at=int(time.time()),
        venv_path=result.get("venv_path"),
    )
    return auth_db.get_team_env(env_id)


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
    job = auth_db.get_project_refresh_job(project_id)
    return {"job": job}


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
    # Replace any existing job for this project (v1: one-job-per-project).
    existing = auth_db.get_project_refresh_job(req.project_id)
    if existing:
        auth_db.delete_refresh_job(existing["id"])
    return auth_db.create_refresh_job(
        req.project_id,
        schedule=req.schedule, env_id=req.env_id,
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


# ── Run executor ─────────────────────────────────────────────────────────────

def execute_refresh_job(job_id: str) -> dict:
    """Run a single refresh job synchronously. Returns the run row.

    Sequence:
      1. Insert a `studio_refresh_runs` row in 'running' state.
      2. Build the merged env (host + team env_vars + per-job extra_env).
      3. Drop the script_source to a temp file in the env's working dir.
      4. Spawn the team's venv python on the script. Capture stdout/stderr.
      5. On success, trigger a project build (formats=['pptx','pdf']) so
         the deck is re-rendered with whatever the script changed.
      6. Update the run row + the job's last_status/next_run_at.
    """
    job = auth_db.get_refresh_job(job_id)
    if not job:
        return {"status": "failed", "error": "job not found"}
    project = auth_db.get_project(job["project_id"])
    if not project:
        auth_db.mark_refresh_job_ran(job_id, status="failed", error="project deleted")
        return {"status": "failed", "error": "project deleted"}

    run = auth_db.create_refresh_run(job_id, job["project_id"])
    log_lines: list[str] = [f"refresh job {job_id} starting at {time.strftime('%Y-%m-%d %H:%M:%S')}"]

    try:
        # Pick python: env's venv if present + ready, else host python.
        py = sys.executable
        env_dir = TEAM_ENVS_ROOT / job["project_id"]  # fallback
        if job.get("env_id"):
            env = auth_db.get_team_env_secret(job["env_id"])
            if env and env.get("status") == "ready" and env.get("venv_path"):
                vp = _venv_python(Path(env["venv_path"]))
                if vp.exists():
                    py = str(vp)
                    log_lines.append(f"using team-env python: {py}")
                else:
                    log_lines.append(f"warning: venv missing at {vp}; using host python")
            else:
                log_lines.append(f"warning: env not ready (status={env.get('status') if env else 'missing'}); using host python")
        else:
            log_lines.append("no env attached; using host python")

        # Build the merged env vars
        merged_env = os.environ.copy()
        if job.get("env_id"):
            env_full = auth_db.get_team_env_secret(job["env_id"]) or {}
            for k, v in (env_full.get("env_vars") or {}).items():
                merged_env[str(k)] = str(v)
        for k, v in (job.get("extra_env") or {}).items():
            merged_env[str(k)] = str(v)
        # Surface what Percy doc to mutate; the script can read these
        merged_env["PERCY_PROJECT_ID"] = project["id"]
        merged_env["PERCY_DOC_ID"] = project.get("doc_id") or ""
        merged_env["PERCY_API_BASE"] = os.environ.get("PERCY_API_BASE", "http://localhost:8000")

        # Drop the script to a working dir
        work_dir = TEAM_ENVS_ROOT / "_runs" / run["id"]
        work_dir.mkdir(parents=True, exist_ok=True)
        script_path = work_dir / job.get("entry_point", "refresh.py")
        script_path.write_text(job.get("script_source", "") or "# (no script)\n", encoding="utf-8")

        # Run with a 5-minute cap
        log_lines.append(f"executing: {py} {script_path.name}")
        r = subprocess.run(
            [py, str(script_path)],
            capture_output=True, text=True, env=merged_env,
            cwd=str(work_dir), timeout=300,
        )
        log_lines.extend((r.stdout or "").splitlines()[-200:])
        if r.stderr:
            log_lines.append("--- stderr ---")
            log_lines.extend((r.stderr or "").splitlines()[-100:])
        if r.returncode != 0:
            raise RuntimeError(f"script exited {r.returncode}")

        # Trigger a project build so the deck reflects whatever the script did.
        # Inline import to avoid a circular dep at module load.
        build_id = None
        try:
            from app.backend import workspace_api as _wapi
            from app.backend.workspace_api import TriggerBuildRequest as _Trig
            # We synthesize a no-auth call by invoking the function directly.
            # Use the project's first owner so authorization passes — OK for v1
            # since the scheduler is in-process.
            members = auth_db.list_org_members(project["org_id"])
            actor = next((m for m in members if m["role"] == "owner"), members[0] if members else None)
            if actor:
                fake_user = {"id": actor["user_id"], "email": actor.get("email", "")}
                fake_request = type("R", (), {"state": type("S", (), {})()})()
                # Bypass auth.require_user by inlining the build core.
                from app.backend import auth_db as _adb
                build = _adb.create_build(
                    project_id=project["id"], triggered_by=fake_user["id"],
                    trigger="scheduled", formats=["pptx", "pdf"],
                )
                build_id = build["id"]
                log_lines.append(f"triggered build {build_id}")
                # Run inline (re-using the trigger_build internals via a thin wrapper).
                _do_inline_build(build_id, project)
        except Exception as e:
            log_lines.append(f"post-build trigger failed: {e}")

        auth_db.update_refresh_run(
            run["id"], status="success", finished_at=int(time.time()),
            log="\n".join(log_lines)[:200000], build_id=build_id,
        )
        auth_db.mark_refresh_job_ran(job_id, status="success")
        return {"status": "success", "run_id": run["id"]}

    except subprocess.TimeoutExpired:
        log_lines.append("ERROR: script timed out after 300s")
        auth_db.update_refresh_run(run["id"], status="failed", finished_at=int(time.time()),
                                   log="\n".join(log_lines)[:200000])
        auth_db.mark_refresh_job_ran(job_id, status="failed", error="timeout")
        return {"status": "failed", "error": "timeout"}
    except Exception as e:
        log_lines.append(f"ERROR: {e}")
        auth_db.update_refresh_run(run["id"], status="failed", finished_at=int(time.time()),
                                   log="\n".join(log_lines)[:200000])
        auth_db.mark_refresh_job_ran(job_id, status="failed", error=str(e)[:1000])
        return {"status": "failed", "error": str(e)}


def _do_inline_build(build_id: str, project: dict) -> None:
    """Replicate the trigger_build core for use from the scheduler.

    Lifted from workspace_api.trigger_build — without HTTP plumbing.
    Best-effort: skips formats that fail.
    """
    from app.backend import main as _backend_main
    from app.backend import auth_db as _adb
    from percy.diagnostics.rebuild import rebuild_pptx as _rebuild_pptx
    started = time.time()
    _adb.update_build(build_id, status="running", started_at=int(started))
    try:
        doc_id = project.get("doc_id")
        if not doc_id or doc_id not in _backend_main._docs:
            if project.get("doc_source"):
                result = _backend_main.onboard(_backend_main.OnboardRequest(path=str(project["doc_source"])))
                doc_id = result.get("doc_id") if isinstance(result, dict) else getattr(result, "doc_id", None)
        if not doc_id or doc_id not in _backend_main._docs:
            raise RuntimeError("no doc to build")
        d = _backend_main._docs[doc_id]
        doc = d["doc"]
        out_dir = Path("uploads") / "builds" / build_id
        out_dir.mkdir(parents=True, exist_ok=True)
        pptx_path = out_dir / f"{project['name'].replace(' ', '_')}.pptx"
        _rebuild_pptx(doc, str(pptx_path))
        outputs = {"pptx": str(pptx_path.resolve())}
        try:
            subprocess.run(["soffice", "--headless", "--convert-to", "pdf",
                            "--outdir", str(out_dir), str(pptx_path)],
                           capture_output=True, timeout=120)
            produced = out_dir / (pptx_path.stem + ".pdf")
            if produced.exists():
                outputs["pdf"] = str(produced.resolve())
        except Exception:
            pass
        finished = time.time()
        _adb.update_build(build_id, status="success", outputs=outputs,
                          summary=f"scheduled build · {len(outputs)} format(s)",
                          finished_at=int(finished),
                          elapsed_ms=int((finished-started)*1000))
    except Exception as e:
        finished = time.time()
        _adb.update_build(build_id, status="failed", error=str(e),
                          finished_at=int(finished),
                          elapsed_ms=int((finished-started)*1000))


@router.post("/api/refresh-jobs/{job_id}/run")
def run_refresh_job_now(request: Request, job_id: str):
    user = auth.require_user(request)
    job = auth_db.get_refresh_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    p = auth_db.get_project(job["project_id"])
    _require_org_member(user, p["org_id"])
    # Run in a thread so the HTTP request returns quickly with the run id.
    result = {"status": "started"}
    def _go():
        result.update(execute_refresh_job(job_id))
    t = threading.Thread(target=_go, daemon=True)
    t.start()
    t.join(timeout=2)  # if it finishes fast, return the real status
    return result


# ── Background scheduler ─────────────────────────────────────────────────────

_scheduler_thread: threading.Thread | None = None
_scheduler_stop = threading.Event()


def _scheduler_loop():
    log.info("refresh scheduler started")
    while not _scheduler_stop.is_set():
        try:
            due = auth_db.list_due_refresh_jobs()
            for job in due:
                log.info("scheduler: running due job %s (project %s)", job["id"], job["project_id"])
                try:
                    execute_refresh_job(job["id"])
                except Exception as e:
                    log.exception("scheduler: job %s failed: %s", job["id"], e)
        except Exception as e:
            log.exception("scheduler tick failed: %s", e)
        # 30s tick — fine for daily/hourly resolution
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
