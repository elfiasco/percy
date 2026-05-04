"""Persistence helpers for Percy Bridge files."""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")

PERCY_SUFFIX = ".percy"


def save_percy(obj: Any, path: str | Path) -> Path:
    """Serialize *obj* to a pickle-backed ``.percy`` file."""

    output_path = _normalize_percy_path(path)
    with output_path.open("wb") as file_obj:
        pickle.dump(obj, file_obj, protocol=pickle.HIGHEST_PROTOCOL)
    return output_path


def load_percy(path: str | Path, expected_type: type[T] | None = None) -> T | Any:
    """Load a pickle-backed ``.percy`` file.

    ``expected_type`` is optional but useful at converter boundaries where the
    caller expects a ``PercyDocument`` or a specific ``BridgeElement`` subtype.
    """

    input_path = _normalize_percy_path(path)
    with input_path.open("rb") as file_obj:
        obj = pickle.load(file_obj)

    if expected_type is not None and not isinstance(obj, expected_type):
        message = f"Expected {expected_type.__name__}, loaded {type(obj).__name__}"
        raise TypeError(message)

    return obj


def _normalize_percy_path(path: str | Path) -> Path:
    percy_path = Path(path)
    if percy_path.suffix != PERCY_SUFFIX:
        percy_path = percy_path.with_suffix(PERCY_SUFFIX)
    return percy_path
