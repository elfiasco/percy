"""Shared diagnostics helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

EMU_PER_INCH = 914400


def ensure_dir(path: str | Path) -> Path:
    output_dir = Path(path)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def emu_to_inches(value: int | None) -> float | None:
    if value is None:
        return None
    return round(float(value) / EMU_PER_INCH, 4)


def length_to_points(value: Any) -> float | None:
    if value is None:
        return None
    points = getattr(value, "pt", None)
    if points is not None:
        return round(float(points), 2)
    return None


def inches_to_emu(value: float | None) -> int:
    return int((value or 0.0) * EMU_PER_INCH)


def write_json(data: dict[str, Any] | list[Any], path: str | Path) -> Path:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    return output_path


def safe_get(callable_obj, default: Any = None) -> Any:
    try:
        return callable_obj()
    except Exception:
        return default


def enum_name(value: Any) -> str | None:
    if value is None:
        return None
    return getattr(value, "name", str(value))
