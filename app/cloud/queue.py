"""SQS job queue for Percy Cloud workers."""

from __future__ import annotations

import json
from typing import Any

import boto3


class SQSJobQueue:
    def __init__(self, queue_url: str) -> None:
        self.queue_url = queue_url
        self._sqs = boto3.client("sqs")

    def enqueue(self, job_id: str, job_type: str, payload: dict[str, Any]) -> str:
        body = json.dumps({"job_id": job_id, "job_type": job_type, "payload": payload})
        resp = self._sqs.send_message(
            QueueUrl=self.queue_url,
            MessageBody=body,
            MessageAttributes={
                "job_type": {
                    "StringValue": job_type,
                    "DataType": "String",
                }
            },
        )
        return resp["MessageId"]


class LocalJobQueue:
    """No-op queue for local dev — jobs are run inline or polled manually."""

    def enqueue(self, job_id: str, job_type: str, payload: dict[str, Any]) -> str:
        return f"local:{job_id}"
