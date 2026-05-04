"""Percy onboard-document worker.

Pulls jobs from the SQS onboard queue, downloads the source PPTX from S3,
runs percy onboarding, stores the Bridge bundle back in S3, and reports
the result to the Percy Cloud API (or directly to Postgres when in VPC).
"""

from __future__ import annotations

import dataclasses
import json
import logging
import os
import pickle
import signal
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator

import boto3
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("percy.worker.onboard")

# -------------------------------------------------------------------------
# Config from environment
# -------------------------------------------------------------------------
SQS_QUEUE_URL = os.environ["SQS_ONBOARD_QUEUE_URL"]
S3_BUCKET = os.environ["S3_BUCKET"]
API_BASE = os.environ.get("PERCY_API_URL", "http://localhost:8000")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
WORKER_ID = os.environ.get("WORKER_ID", f"onboard-worker-{os.getpid()}")
POLL_WAIT = int(os.environ.get("POLL_WAIT_SECONDS", "20"))

PERCY_API_KEY = os.environ.get("PERCY_API_KEY", "")

DB_HOST = os.environ.get("DB_HOST")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "percy")
DB_USER = os.environ.get("DB_USER", "percy")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")

sqs = boto3.client("sqs", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)

_shutdown = False
_db_pool = None


def _handle_sigterm(signum, frame):
    global _shutdown
    log.info("SIGTERM received, shutting down after current job")
    _shutdown = True


signal.signal(signal.SIGTERM, _handle_sigterm)


# -------------------------------------------------------------------------
# Postgres helpers (primary path in production)
# -------------------------------------------------------------------------

def _init_db_pool() -> bool:
    global _db_pool
    if not DB_HOST:
        return False
    try:
        import psycopg2
        from psycopg2.pool import ThreadedConnectionPool
        _db_pool = ThreadedConnectionPool(
            minconn=1, maxconn=3,
            host=DB_HOST, port=int(DB_PORT),
            dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD,
        )
        log.info("DB pool initialised (%s:%s/%s)", DB_HOST, DB_PORT, DB_NAME)
        return True
    except Exception as exc:
        log.warning("could not init DB pool: %s", exc)
        return False


@contextmanager
def _get_conn() -> Generator:
    if _db_pool is None:
        raise RuntimeError("DB pool not initialised")
    conn = _db_pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _db_pool.putconn(conn)


def db_start_job(job_id: str) -> None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE jobs
                   SET status='running', worker_id=%s, started_at=NOW()
                   WHERE id=%s AND status='queued'""",
                (WORKER_ID, job_id),
            )


def db_complete_job(job_id: str, result: dict) -> None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE jobs
                   SET status='completed', result=%s, finished_at=NOW()
                   WHERE id=%s""",
                (json.dumps(result), job_id),
            )


def db_fail_job(job_id: str, error: str) -> None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE jobs
                   SET status='failed', error=%s, finished_at=NOW()
                   WHERE id=%s""",
                (error, job_id),
            )


def db_update_document_status(document_id: str, status: str, bundle_uri: str | None = None) -> None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            if bundle_uri:
                cur.execute(
                    "UPDATE documents SET status=%s, bundle_uri=%s WHERE id=%s",
                    (status, bundle_uri, document_id),
                )
            else:
                cur.execute(
                    "UPDATE documents SET status=%s WHERE id=%s",
                    (status, document_id),
                )


def db_get_document_storage_uri(document_id: str) -> str | None:
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT storage_uri FROM documents WHERE id=%s", (document_id,))
            row = cur.fetchone()
            return row[0] if row else None


# -------------------------------------------------------------------------
# SQS helpers
# -------------------------------------------------------------------------

def poll_one() -> dict | None:
    resp = sqs.receive_message(
        QueueUrl=SQS_QUEUE_URL,
        MaxNumberOfMessages=1,
        WaitTimeSeconds=POLL_WAIT,
        MessageAttributeNames=["All"],
    )
    messages = resp.get("Messages", [])
    return messages[0] if messages else None


def delete_message(receipt_handle: str) -> None:
    sqs.delete_message(QueueUrl=SQS_QUEUE_URL, ReceiptHandle=receipt_handle)


# -------------------------------------------------------------------------
# Percy API helpers (fallback for local dev)
# -------------------------------------------------------------------------

def _api_headers() -> dict:
    h = {"Content-Type": "application/json"}
    if PERCY_API_KEY:
        h["X-Percy-Api-Key"] = PERCY_API_KEY
    return h


def api_start_job(job_id: str) -> None:
    r = requests.post(
        f"{API_BASE}/api/cloud/jobs/{job_id}/start",
        json={"worker_id": WORKER_ID},
        headers=_api_headers(),
        timeout=10,
    )
    r.raise_for_status()


def api_complete_job(job_id: str, result: dict[str, Any]) -> None:
    r = requests.post(
        f"{API_BASE}/api/cloud/jobs/{job_id}/complete",
        json={"worker_id": WORKER_ID, "result": result},
        headers=_api_headers(),
        timeout=10,
    )
    r.raise_for_status()


def api_fail_job(job_id: str, error: str) -> None:
    r = requests.post(
        f"{API_BASE}/api/cloud/jobs/{job_id}/fail",
        json={"worker_id": WORKER_ID, "error": error},
        headers=_api_headers(),
        timeout=10,
    )
    r.raise_for_status()


def api_update_document_status(document_id: str, status: str, bundle_uri: str | None = None) -> None:
    body: dict = {"status": status}
    if bundle_uri:
        body["bundle_uri"] = bundle_uri
    try:
        r = requests.patch(
            f"{API_BASE}/api/cloud/documents/{document_id}/status",
            json=body,
            headers=_api_headers(),
            timeout=10,
        )
        r.raise_for_status()
    except Exception as exc:
        log.warning("could not update document status to %s: %s", status, exc)


# -------------------------------------------------------------------------
# Unified status helpers — DB primary, API fallback
# -------------------------------------------------------------------------

def start_job(job_id: str) -> None:
    if _db_pool is not None:
        db_start_job(job_id)
    else:
        api_start_job(job_id)


def complete_job(job_id: str, result: dict) -> None:
    if _db_pool is not None:
        db_complete_job(job_id, result)
    else:
        api_complete_job(job_id, result)


def fail_job(job_id: str, error: str) -> None:
    if _db_pool is not None:
        db_fail_job(job_id, error)
    else:
        api_fail_job(job_id, error)


def update_document_status(document_id: str, status: str, bundle_uri: str | None = None) -> None:
    if _db_pool is not None:
        try:
            db_update_document_status(document_id, status, bundle_uri)
        except Exception as exc:
            log.warning("could not update document status via DB to %s: %s", status, exc)
    else:
        api_update_document_status(document_id, status, bundle_uri)


def get_document_storage_uri(document_id: str) -> str | None:
    if _db_pool is not None:
        return db_get_document_storage_uri(document_id)
    try:
        r = requests.get(
            f"{API_BASE}/api/cloud/documents/{document_id}",
            headers=_api_headers(),
            timeout=10,
        )
        r.raise_for_status()
        return r.json().get("storage_uri")
    except Exception as exc:
        log.error("could not fetch document %s: %s", document_id, exc)
        return None


# -------------------------------------------------------------------------
# S3 helpers
# -------------------------------------------------------------------------

def s3_download(s3_uri: str, local_path: Path) -> None:
    """Download s3://bucket/key to local_path."""
    parts = s3_uri.removeprefix("s3://").split("/", 1)
    bucket, key = parts[0], parts[1]
    s3.download_file(bucket, key, str(local_path))


def s3_upload_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    s3.put_object(Bucket=S3_BUCKET, Key=key, Body=data, ContentType=content_type)
    return f"s3://{S3_BUCKET}/{key}"


# -------------------------------------------------------------------------
# Core onboard task
# -------------------------------------------------------------------------

def _dataclass_to_dict(obj: Any) -> Any:
    """Recursively convert dataclasses/lists/dicts to JSON-safe structures."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {k: _dataclass_to_dict(v) for k, v in dataclasses.asdict(obj).items()}
    if isinstance(obj, list):
        return [_dataclass_to_dict(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _dataclass_to_dict(v) for k, v in obj.items()}
    if isinstance(obj, Path):
        return str(obj)
    return obj


def run_onboard(job_id: str, document_id: str, storage_uri: str) -> dict[str, Any]:
    from percy.diagnostics.onboard import onboard_pptx

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        pptx_path = tmp_path / "source.pptx"

        log.info("downloading %s", storage_uri)
        s3_download(storage_uri, pptx_path)

        log.info("onboarding %s", pptx_path)
        percy_doc = onboard_pptx(pptx_path)

        # Store pickle bundle (full fidelity for rebuild)
        bundle_key = f"bundles/{document_id}/bridge.pkl"
        pickle_bytes = pickle.dumps(percy_doc)
        s3_upload_bytes(bundle_key, pickle_bytes, "application/octet-stream")
        log.info("stored bundle at %s", bundle_key)

        # Store lightweight JSON summary (slide count, element counts)
        try:
            summary = {
                "slide_count": len(percy_doc.slides),
                "source_path": percy_doc.source_path,
                "theme_colors": percy_doc.theme_colors,
                "metadata": _dataclass_to_dict(percy_doc.metadata),
                "element_counts": {
                    slide_idx: len(slide.elements)
                    for slide_idx, slide in enumerate(percy_doc.slides)
                },
            }
        except Exception as exc:
            log.warning("summary serialization partial: %s", exc)
            summary = {"slide_count": len(percy_doc.slides)}

        summary_key = f"bundles/{document_id}/summary.json"
        s3_upload_bytes(
            summary_key,
            json.dumps(summary, default=str).encode(),
            "application/json",
        )

        return {
            "bundle_uri": f"s3://{S3_BUCKET}/{bundle_key}",
            "summary_uri": f"s3://{S3_BUCKET}/{summary_key}",
            "slide_count": summary.get("slide_count", 0),
        }


# -------------------------------------------------------------------------
# Main loop
# -------------------------------------------------------------------------

def process_message(msg: dict) -> None:
    body = json.loads(msg["Body"])
    job_id = body.get("job_id")
    payload = body.get("payload", {})
    document_id = payload.get("document_id")

    if not job_id or not document_id:
        log.warning("malformed message: %s", body)
        return

    log.info("starting job %s for document %s", job_id, document_id)

    try:
        start_job(job_id)
    except Exception as exc:
        log.warning("could not mark job started (may already be running): %s", exc)

    # Resolve storage_uri — prefer payload, fall back to DB/API
    storage_uri = payload.get("storage_uri") or get_document_storage_uri(document_id)

    if not storage_uri:
        fail_job(job_id, "No storage_uri for document — upload file first via prepare-upload")
        return

    update_document_status(document_id, "processing")
    try:
        result = run_onboard(job_id, document_id, storage_uri)
        complete_job(job_id, result)
        update_document_status(document_id, "ready", result.get("bundle_uri"))
        log.info("job %s complete: %s slides", job_id, result.get("slide_count"))
    except Exception as exc:
        log.exception("job %s failed", job_id)
        update_document_status(document_id, "error")
        try:
            fail_job(job_id, str(exc))
        except Exception:
            pass


def main() -> None:
    log.info("Percy onboard worker starting (worker_id=%s)", WORKER_ID)
    log.info("queue=%s bucket=%s api=%s", SQS_QUEUE_URL, S3_BUCKET, API_BASE)

    _init_db_pool()
    if _db_pool is not None:
        log.info("using direct DB for job status updates")
    else:
        log.info("using HTTP API for job status updates (no DB_HOST set)")

    while not _shutdown:
        try:
            msg = poll_one()
        except Exception as exc:
            log.error("SQS poll error: %s", exc)
            time.sleep(5)
            continue

        if msg is None:
            continue

        try:
            process_message(msg)
        except Exception as exc:
            log.exception("unhandled error processing message: %s", exc)
        finally:
            try:
                delete_message(msg["ReceiptHandle"])
            except Exception as exc:
                log.warning("could not delete message: %s", exc)

    log.info("worker shutdown complete")


if __name__ == "__main__":
    main()
