"""End-to-end smoke test for the Percy Cloud pipeline.

Usage:
    python scripts/e2e_cloud_test.py --pptx path/to/file.pptx [--api https://...]

Tests the full flow:
  1. Create org / project
  2. prepare-upload → get presigned S3 PUT URL
  3. PUT file to S3
  4. Create onboard job
  5. Poll until job completes
  6. Print bundle URI
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import requests

DEFAULT_API = "https://v9ghdhdczr.us-east-1.awsapprunner.com"


def run(pptx_path: Path, api: str, api_key: str | None = None) -> None:
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    if api_key:
        s.headers["X-Percy-Api-Key"] = api_key

    print(f"API: {api}")
    print(f"File: {pptx_path}")

    # 1. Health
    r = s.get(f"{api}/api/cloud/health"); r.raise_for_status()
    print(f"Health: {r.json()}")

    # 2. Org
    r = s.post(f"{api}/api/cloud/orgs", json={
        "name": "E2E Test Org", "slug": f"e2e-{int(time.time())}", "owner_user_id": "e2e-user"
    }); r.raise_for_status()
    org = r.json(); print(f"Org: {org['id']}")

    # 3. Project
    r = s.post(f"{api}/api/cloud/orgs/{org['id']}/projects", json={"name": "E2E Project"}); r.raise_for_status()
    project = r.json(); print(f"Project: {project['id']}")

    # 4. Prepare upload
    r = s.post(f"{api}/api/cloud/projects/{project['id']}/documents/prepare-upload", json={
        "name": pptx_path.name,
        "source_format": "pptx",
        "content_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "size_bytes": pptx_path.stat().st_size,
        "created_by_id": "e2e-user",
    }); r.raise_for_status()
    prep = r.json(); doc_id = prep["document"]["id"]; upload_url = prep["upload_url"]
    print(f"Document: {doc_id}")
    print(f"Upload URL: {upload_url[:80]}...")

    # 5. Upload file directly to S3
    file_bytes = pptx_path.read_bytes()
    put_resp = requests.put(
        upload_url,
        data=file_bytes,
        headers={"Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
    )
    put_resp.raise_for_status()
    print(f"Uploaded {len(file_bytes):,} bytes to S3")

    # 6. Create job
    r = s.post(f"{api}/api/cloud/documents/{doc_id}/jobs", json={
        "job_type": "onboard_document",
        "requested_by_id": "e2e-user",
        "parameters": {},
    }); r.raise_for_status()
    job = r.json(); job_id = job["id"]
    print(f"Job: {job_id} status={job['status']}")

    # 7. Poll until complete or failed
    print("Polling for job completion...")
    for attempt in range(120):
        time.sleep(5)
        r = s.get(f"{api}/api/cloud/jobs/{job_id}"); r.raise_for_status()
        job = r.json()
        print(f"  [{attempt+1:02d}] status={job['status']}")
        if job["status"] == "completed":
            print(f"\n✅ Job complete!")
            print(f"   bundle_uri:  {job['result'].get('bundle_uri')}")
            print(f"   summary_uri: {job['result'].get('summary_uri')}")
            print(f"   slides:      {job['result'].get('slide_count')}")
            return
        if job["status"] == "failed":
            print(f"\n❌ Job failed: {job.get('error')}")
            sys.exit(1)

    print("Timed out waiting for job to complete")
    sys.exit(2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pptx", required=True, type=Path)
    parser.add_argument("--api", default=DEFAULT_API)
    parser.add_argument("--api-key", default=os.environ.get("PERCY_API_KEY"))
    args = parser.parse_args()
    run(args.pptx, args.api, args.api_key)
