"""Percy document refresh scheduler Lambda.

Triggered on a cron schedule (EventBridge). Queries Postgres for all
"ready" documents and dispatches a fresh onboard_document SQS job for
each one so the Bridge bundle stays up to date.

Env vars (injected by CDK):
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
  SQS_ONBOARD_QUEUE_URL
  AWS_DEFAULT_REGION
"""

from __future__ import annotations

import json
import logging
import os
import uuid

import boto3
import psycopg2

log = logging.getLogger()
log.setLevel(logging.INFO)

SQS_QUEUE_URL  = os.environ["SQS_ONBOARD_QUEUE_URL"]
AWS_REGION     = os.environ.get("AWS_REGION", "us-east-1")  # Lambda injects AWS_REGION automatically
DB_HOST        = os.environ["DB_HOST"]
DB_PORT        = int(os.environ.get("DB_PORT", "5432"))
DB_NAME        = os.environ.get("DB_NAME", "percy")
DB_USER        = os.environ.get("DB_USER", "percy")
DB_SECRET_ARN  = os.environ["DB_SECRET_ARN"]

sqs = boto3.client("sqs", region_name=AWS_REGION)
sm  = boto3.client("secretsmanager", region_name=AWS_REGION)

_db_password: str | None = None


def _get_db_password() -> str:
    global _db_password
    if _db_password is None:
        resp = sm.get_secret_value(SecretId=DB_SECRET_ARN)
        secret = json.loads(resp["SecretString"])
        _db_password = secret["password"]
    return _db_password


def _get_ready_documents(conn) -> list[dict]:
    """Return all documents with status='ready' and a bundle_uri set."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT d.id, d.project_id, d.storage_uri, d.bundle_uri,
                   d.name, p.org_id
            FROM documents d
            JOIN projects p ON p.id = d.project_id
            WHERE d.status = 'ready'
              AND d.bundle_uri IS NOT NULL
              AND d.storage_uri IS NOT NULL
            ORDER BY d.created_at
            """,
        )
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _create_job(conn, doc: dict) -> str:
    """Insert a new queued job row and return the job_id."""
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO jobs
              (id, org_id, project_id, document_id, job_type, status, requested_by_id, parameters)
            VALUES (%s, %s, %s, %s, 'onboard_document', 'queued', 'scheduler', %s)
            """,
            (
                job_id,
                doc["org_id"],
                doc["project_id"],
                doc["id"],
                json.dumps({}),
            ),
        )
    return job_id


def _dispatch_to_sqs(job_id: str, doc: dict) -> None:
    """Send the job message to SQS so the ECS worker picks it up."""
    msg = {
        "job_id":   job_id,
        "job_type": "onboard_document",
        "payload": {
            "document_id": doc["id"],
            "storage_uri": doc["storage_uri"],
        },
    }
    sqs.send_message(
        QueueUrl=SQS_QUEUE_URL,
        MessageBody=json.dumps(msg),
    )


def handler(event, context):
    """Lambda entry point."""
    log.info("Percy refresh-scheduler: starting")

    try:
        conn = psycopg2.connect(
            host=DB_HOST, port=DB_PORT,
            dbname=DB_NAME, user=DB_USER, password=_get_db_password(),
            connect_timeout=10,
        )
    except Exception as exc:
        log.error("DB connection failed: %s", exc)
        return {"statusCode": 500, "body": str(exc)}

    dispatched = 0
    try:
        docs = _get_ready_documents(conn)
        log.info("Found %d ready documents to refresh", len(docs))
        for doc in docs:
            try:
                job_id = _create_job(conn, doc)
                conn.commit()
                _dispatch_to_sqs(job_id, doc)
                dispatched += 1
                log.info("Dispatched job %s for document %s (%s)", job_id, doc["id"], doc["name"])
            except Exception as exc:
                conn.rollback()
                log.warning("Failed to dispatch job for %s: %s", doc["id"], exc)
    finally:
        conn.close()

    log.info("Percy refresh-scheduler: dispatched %d jobs", dispatched)
    return {"statusCode": 200, "body": json.dumps({"dispatched": dispatched})}
