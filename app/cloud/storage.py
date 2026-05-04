"""Storage abstraction for cloud-ready Percy artifacts."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class ObjectStorage(Protocol):
    def put_object(self, key: str, payload: bytes, content_type: str | None = None) -> str:
        """Store bytes and return a storage URI."""

    def get_object(self, key: str) -> bytes:
        """Load bytes for a storage key."""

    def exists(self, key: str) -> bool:
        """Return True when the storage key exists."""


class LocalObjectStorage:
    """Filesystem-backed storage that mirrors the future S3 interface."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def put_object(self, key: str, payload: bytes, content_type: str | None = None) -> str:
        path = self._path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        if content_type:
            path.with_suffix(path.suffix + ".content-type").write_text(content_type, encoding="utf-8")
        return f"local://{key}"

    def get_object(self, key: str) -> bytes:
        return self._path_for(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path_for(key).exists()

    def _path_for(self, key: str) -> Path:
        safe_parts = [part for part in key.replace("\\", "/").split("/") if part not in {"", ".", ".."}]
        return self.root.joinpath(*safe_parts)

