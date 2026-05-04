"""S3-backed object storage for Percy Cloud artifacts."""

from __future__ import annotations

import boto3
import botocore.exceptions


class S3ObjectStorage:
    def __init__(self, bucket: str, prefix: str = "") -> None:
        self.bucket = bucket
        self.prefix = prefix.rstrip("/")
        self._s3 = boto3.client("s3")

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def put_object(self, key: str, payload: bytes, content_type: str | None = None) -> str:
        kwargs: dict = {"Bucket": self.bucket, "Key": self._key(key), "Body": payload}
        if content_type:
            kwargs["ContentType"] = content_type
        self._s3.put_object(**kwargs)
        return f"s3://{self.bucket}/{self._key(key)}"

    def get_object(self, key: str) -> bytes:
        resp = self._s3.get_object(Bucket=self.bucket, Key=self._key(key))
        return resp["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self._s3.head_object(Bucket=self.bucket, Key=self._key(key))
            return True
        except botocore.exceptions.ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return False
            raise

    def generate_presigned_put_url(
        self, key: str, content_type: str | None = None, expires: int = 3600
    ) -> str:
        params: dict = {"Bucket": self.bucket, "Key": self._key(key)}
        if content_type:
            params["ContentType"] = content_type
        return self._s3.generate_presigned_url(
            "put_object", Params=params, ExpiresIn=expires
        )

    def generate_presigned_get_url(self, key: str, expires: int = 3600) -> str:
        return self._s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": self._key(key)},
            ExpiresIn=expires,
        )
