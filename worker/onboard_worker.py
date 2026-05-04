"""Percy onboard-document worker.

Pulls jobs from the SQS onboard queue, downloads the source PPTX from S3,
runs percy onboarding, stores the Bridge bundle back in S3, and reports
the result to the Percy Cloud API.
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
from pathlib import Path
from typing import Any

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

sqs = boto3.client("sqs", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)

_shutdown = False


def _handle_sigterm(signum, frame):
    global _shutdown
    log.info("SIGTERM received, shutting down after current job")
    _shutdown = True


signal.signal(signal.SIGTERM, _handle_sigterm)


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
# Percy API helpers
# -------------------------------------------------------------------------

def api_start_job(job_id: str) -> None:
    r = requests.post(
        f"{API_BASE}/api/cloud/jobs/{job_id}/start",
        json={"worker_id": WORKER_ID},
        timeout=10,
    )
    r.raise_for_status()


def api_complete_job(job_id: str, result: dict[str, Any]) -> None:
    r = requests.post(
        f"{API_BASE}/api/cloud/jobs/{job_id}/complete",
        json={"worker_id": WORKER_ID, "result": result},
        timeout=10,
    )
    r.raise_for_status()


def api_fail_job(job_id: str, error: str) -> None:
    r = requests.post(
        f"{API_BASE}/api/cloud/jobs/{job_id}/fail",
        json={"worker_id": WORKER_ID, "error": error},
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
            timeout=10,
        )
        r.raise_for_status()
    except Exception as exc:
        log.warning("could not update document status to %s: %s", status, exc)


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
        api_start_job(job_id)
    except Exception as exc:
        log.warning("could not mark job started (may already be running): %s", exc)

    # Resolve storage_uri — prefer payload, fall back to fetching document record
    params_storage_uri = payload.get("storage_uri")
    if not params_storage_uri:
        try:
            r = requests.get(f"{API_BASE}/api/cloud/documents/{document_id}", timeout=10)
            r.raise_for_status()
            doc_data = r.json()
            params_storage_uri = doc_data.get("storage_uri")
        except Exception as exc:
            log.error("could not fetch document %s: %s", document_id, exc)

    if not params_storage_uri:
        api_fail_job(job_id, "No storage_uri for document — upload file first via prepare-upload")
        return

    api_update_document_status(document_id, "processing")
    try:
        result = run_onboard(job_id, document_id, params_storage_uri)
        api_complete_job(job_id, result)
        api_update_document_status(document_id, "ready", result.get("bundle_uri"))
        log.info("job %s complete: %s slides", job_id, result.get("slide_count"))
    except Exception as exc:
        log.exception("job %s failed", job_id)
        api_update_document_status(document_id, "error")
        try:
            api_fail_job(job_id, str(exc))
        except Exception:
            pass


def main() -> None:
    log.info("Percy onboard worker starting (worker_id=%s)", WORKER_ID)
    log.info("queue=%s bucket=%s api=%s", SQS_QUEUE_URL, S3_BUCKET, API_BASE)

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
