"""Tableau-specific routes — extracted from main.py.

Handles Tableau workbook payloads, packaged images, and native Tableau Desktop
screenshot capture (per-artifact and batch).

Register with: `register_tableau_router(app)` from main.py.
"""
from __future__ import annotations

import base64
import logging
import os
import re
import sys
import time
import zipfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageChops, ImageGrab, ImageStat

log = logging.getLogger("percy.api")


# ─── Shared helpers imported from main at registration time ──────────────────
# These are wired up by register_tableau_router() to avoid circular imports.
_require: Any = None
_record_event: Any = None
_update_history_snapshot: Any = None
_tableau_payload: Any = None
_CACHE_DIR: Path = Path("/tmp/percy/.rendercache")  # overwritten at registration


# ─── Smart capture helpers ───────────────────────────────────────────────────

def _pixel_quality_score(img: Image.Image) -> float:
    """0–100 quality score. 0 = black/blank, 100 = rich rendered content.

    Uses mean brightness and standard deviation of the grayscale image.
    A fully-black screenshot has mean≈0; a fully-white blank has std≈0.
    A rendered chart has mean in a middle range and meaningful std.
    """
    import math
    gray = img.convert("L")
    stat = ImageStat.Stat(gray)
    mean = stat.mean[0]
    std  = stat.stddev[0]
    brightness_score = min(50.0, max(0.0, (mean - 10.0) / 4.0))   # mean 10→50 maps to 0→10; 210→50
    texture_score    = min(50.0, std * 50.0 / 70.0)                # std=70 → 50 points
    return brightness_score + texture_score


def _images_rms_diff(img1: Image.Image, img2: Image.Image) -> float:
    """RMS pixel difference between two images (downsampled for speed)."""
    import math
    s1 = img1.convert("L").resize((80, 45), Image.BILINEAR)
    s2 = img2.convert("L").resize((80, 45), Image.BILINEAR)
    diff = ImageChops.difference(s1, s2)
    stat = ImageStat.Stat(diff)
    return stat.rms[0]


def _wait_until_stable(
    grab_fn: "Any",
    *,
    max_wait: float = 8.0,
    stability_hold: float = 0.8,
    rms_threshold: float = 1.2,
    min_quality: float = 12.0,
    poll_interval: float = 0.35,
) -> Image.Image:
    """Poll screenshots until two consecutive frames are nearly identical AND quality is ok.

    Returns the stable (best-quality) frame. Falls back to whatever we have at timeout.
    """
    deadline = time.time() + max_wait
    prev = grab_fn()
    stable_since: float | None = None
    best = prev
    best_q = _pixel_quality_score(prev)

    while time.time() < deadline:
        time.sleep(poll_interval)
        curr = grab_fn()
        q = _pixel_quality_score(curr)
        rms = _images_rms_diff(prev, curr)

        if q > best_q:
            best = curr
            best_q = q

        if rms <= rms_threshold and q >= min_quality:
            if stable_since is None:
                stable_since = time.time()
            elif time.time() - stable_since >= stability_hold:
                return curr  # held stable long enough
        else:
            stable_since = None

        prev = curr

    return best  # return highest-quality frame seen, even if not fully stable


def _lm_studio_vision_check(
    img_path: Path,
    lm_url: str | None = None,
) -> dict[str, Any]:
    if lm_url is None:
        # Same env-var pattern as agent_chat._LMSTUDIO_BASE — keeping callers
        # off literal localhost URLs so deployments can point at a different
        # LM Studio host without code changes.
        lm_url = os.environ.get("PERCY_LMSTUDIO_URL", "http://localhost:1234").rstrip("/") + "/v1/chat/completions"
    """Ask the LM Studio vision model if the screenshot looks fully rendered.

    Returns {ok: bool|None, score: int 1-5, reason: str, description: str}.
    ok=None means the vision call itself failed (network/model error).
    """
    import json as _json
    import urllib.request as _req

    try:
        with open(img_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()

        prompt = (
            "You are reviewing a screenshot of Tableau Desktop to decide if the visualization "
            "is fully rendered and ready to save.\n\n"
            "Answer ONLY with valid JSON — no extra text:\n"
            '{"ok": true_or_false, "score": 1_to_5, "reason": "one sentence", "description": "what you see"}\n\n'
            "ok=true  → chart/dashboard is fully rendered with real data visible\n"
            "ok=false → screen is black, blank, still loading a spinner, or shows an error\n"
            "score    → 1=completely black/blank, 5=fully rendered with clear data"
        )

        payload = _json.dumps({
            "model": "google/gemma-3-27b",
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }],
            "max_tokens": 150,
            "temperature": 0.05,
        }).encode()

        req = _req.Request(lm_url, data=payload, headers={"Content-Type": "application/json"})
        with _req.urlopen(req, timeout=60) as resp:
            body = _json.loads(resp.read())

        text = body["choices"][0]["message"]["content"].strip()
        m = re.search(r"\{.*?\}", text, re.DOTALL)
        if m:
            result = _json.loads(m.group())
            # normalise keys
            return {
                "ok":          bool(result.get("ok", False)),
                "score":       int(result.get("score", 0)),
                "reason":      str(result.get("reason", "")),
                "description": str(result.get("description", "")),
            }
        ok = ("true" in text.lower()) and ("false" not in text.lower())
        return {"ok": ok, "score": 3 if ok else 1, "reason": text[:200], "description": ""}

    except Exception as exc:
        log.warning("vision_check failed for %s: %s", img_path.name, exc)
        return {"ok": None, "score": None, "reason": str(exc)[:200], "description": "vision unavailable"}


def _smart_capture_one(
    grab_fn: "Any",
    out_path: Path,
    sheet_name: str,
    *,
    max_render_wait: float = 10.0,
    quality_threshold: float = 14.0,
    max_retries: int = 3,
    use_vision: bool = True,
) -> dict[str, Any]:
    """Capture one sheet with stability wait, quality check, and optional vision verification."""
    attempt = 0
    best_img: Image.Image | None = None
    best_q = -1.0

    while attempt < max_retries:
        wait_this_round = max_render_wait * (attempt + 1)
        img = _wait_until_stable(
            grab_fn,
            max_wait=wait_this_round,
            min_quality=quality_threshold,
        )
        q = _pixel_quality_score(img)
        if best_img is None or q > best_q:
            best_img = img
            best_q = q

        if q >= quality_threshold:
            break

        attempt += 1
        log.warning("smart_capture: %s attempt %d quality=%.1f < %.1f, retrying", sheet_name, attempt, q, quality_threshold)
        if attempt < max_retries:
            time.sleep(1.5)  # brief pause before re-checking

    assert best_img is not None
    best_img.save(out_path)

    vision: dict[str, Any] = {}
    if use_vision:
        vision = _lm_studio_vision_check(out_path)
        # If vision says bad and we have retries left, try one last grab
        if vision.get("ok") is False and best_q < 50.0:
            log.warning(
                "smart_capture: vision rejected %s (score=%s, reason=%s) — final grab",
                sheet_name, vision.get("score"), vision.get("reason"),
            )
            time.sleep(max_render_wait)
            final_img = grab_fn()
            final_q = _pixel_quality_score(final_img)
            if final_q > best_q:
                final_img.save(out_path)
                best_q = final_q
                vision = _lm_studio_vision_check(out_path)

    return {
        "quality_score": round(best_q, 1),
        "vision":        vision,
        "ok":            best_q >= quality_threshold,
    }


def _pil_to_bytes(img: Image.Image, fmt: str = "PNG") -> bytes:
    import io
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _force_hwnd_topmost(hwnd: int) -> None:
    """Force window above all other windows so ImageGrab captures it, not what's in front."""
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    HWND_TOPMOST = ctypes.c_void_p(-1)
    SWP_NOMOVE    = 0x0002
    SWP_NOSIZE    = 0x0001
    SWP_SHOWWINDOW = 0x0040
    user32.SetWindowPos(
        wintypes.HWND(hwnd), HWND_TOPMOST,
        0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
    )
    # Thread-input attachment trick so SetForegroundWindow works from background threads
    current_tid = ctypes.windll.kernel32.GetCurrentThreadId()
    fg_hwnd = user32.GetForegroundWindow()
    fg_tid  = user32.GetWindowThreadProcessId(fg_hwnd, None)
    if fg_tid and fg_tid != current_tid:
        user32.AttachThreadInput(current_tid, fg_tid, True)
        user32.SetForegroundWindow(wintypes.HWND(hwnd))
        user32.AttachThreadInput(current_tid, fg_tid, False)
    else:
        user32.SetForegroundWindow(wintypes.HWND(hwnd))
    user32.BringWindowToTop(wintypes.HWND(hwnd))


def _restore_hwnd_notopmost(hwnd: int) -> None:
    """Remove topmost flag from window after capture is complete."""
    import ctypes
    from ctypes import wintypes
    HWND_NOTOPMOST = ctypes.c_void_p(-2)
    SWP_NOMOVE = 0x0002
    SWP_NOSIZE = 0x0001
    ctypes.windll.user32.SetWindowPos(
        wintypes.HWND(hwnd), HWND_NOTOPMOST,
        0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE,
    )


def _get_window_title(hwnd: int) -> str:
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    length = user32.GetWindowTextLengthW(wintypes.HWND(hwnd))
    if length <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(wintypes.HWND(hwnd), buf, length + 1)
    return buf.value


def _sendinput_key_combo(vk_mod: int, vk_key: int) -> None:
    """Send modifier+key via SendInput — goes to the globally-focused window.

    This is the correct way to simulate keystrokes in modern Windows apps
    (SendMessageW WM_KEYDOWN is ignored by apps that use TranslateMessage/DispatchMessage).
    Caller must ensure the target window is the foreground window first.
    """
    import ctypes

    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002

    class _KI(ctypes.Structure):
        _fields_ = [
            ("wVk",         ctypes.c_ushort),
            ("wScan",       ctypes.c_ushort),
            ("dwFlags",     ctypes.c_ulong),
            ("time",        ctypes.c_ulong),
            ("dwExtraInfo", ctypes.c_ulong),
        ]

    class _INPUT(ctypes.Structure):
        _fields_ = [
            ("type", ctypes.c_ulong),
            ("ki",   _KI),
            ("_pad", ctypes.c_ubyte * 8),
        ]

    seq = [
        _INPUT(type=INPUT_KEYBOARD, ki=_KI(wVk=vk_mod)),
        _INPUT(type=INPUT_KEYBOARD, ki=_KI(wVk=vk_key)),
        _INPUT(type=INPUT_KEYBOARD, ki=_KI(wVk=vk_key, dwFlags=KEYEVENTF_KEYUP)),
        _INPUT(type=INPUT_KEYBOARD, ki=_KI(wVk=vk_mod, dwFlags=KEYEVENTF_KEYUP)),
    ]
    arr = (_INPUT * len(seq))(*seq)
    ctypes.windll.user32.SendInput(len(seq), arr, ctypes.sizeof(_INPUT))


def _send_ctrl_pgup(user32: Any, hwnd: int, canvas_xy: tuple[int, int] | None = None) -> None:
    """Send Ctrl+PgUp to navigate to the previous Tableau tab."""
    import pyautogui
    _force_hwnd_topmost(hwnd)
    time.sleep(0.05)
    pyautogui.hotkey("ctrl", "pageup")


def _mouse_click_screen(x: int, y: int) -> None:
    """Perform a real left-click at absolute screen coordinates."""
    import ctypes
    ctypes.windll.user32.SetCursorPos(x, y)
    time.sleep(0.06)
    ctypes.windll.user32.mouse_event(0x0002, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTDOWN
    time.sleep(0.06)
    ctypes.windll.user32.mouse_event(0x0004, 0, 0, 0, 0)  # MOUSEEVENTF_LEFTUP


def _find_tab_via_ocr(sheet_name: str, win_rect: tuple[int, int, int, int]) -> tuple[int, int] | None:
    """Tesseract-OCR the Tableau tab strip to find (screen_x, screen_y) of the named tab.

    Tesseract must be installed at C:\\Program Files\\Tesseract-OCR\\tesseract.exe.
    Returns None if the tab is not found or Tesseract is unavailable.
    """
    try:
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

        win_l, win_t, win_r, win_b = win_rect
        tab_h = 38
        tab_bbox = (win_l, win_b - tab_h, win_r, win_b)
        tab_img = ImageGrab.grab(bbox=tab_bbox)

        # 2× upscale for better OCR on small tab text
        w, h = tab_img.size
        tab_big = tab_img.resize((w * 2, h * 2), Image.LANCZOS)

        data = pytesseract.image_to_data(tab_big, output_type=pytesseract.Output.DICT)

        texts = [str(t).strip() for t in data["text"]]
        name_lower = sheet_name.lower().strip()
        target_words = name_lower.split()

        # Helper: screen coords from OCR pixel coords inside the 2× upscaled crop
        def to_screen(px: int, py: int) -> tuple[int, int]:
            return win_l + px // 2, win_b - tab_h + py // 2

        # Exact single-token match
        for i, word in enumerate(texts):
            if word.lower() == name_lower:
                cx = data["left"][i] + data["width"][i] // 2
                cy = data["top"][i]  + data["height"][i] // 2
                return to_screen(cx, cy)

        # Multi-word contiguous match
        n = len(target_words)
        for i in range(len(texts) - n + 1):
            window_words = [texts[j].lower() for j in range(i, i + n)]
            if window_words == target_words:
                left  = data["left"][i]
                right = data["left"][i + n - 1] + data["width"][i + n - 1]
                cx = (left + right) // 2
                cy = data["top"][i] + data["height"][i] // 2
                return to_screen(cx, cy)

        # Substring fallback: join all tokens and look for the name
        joined = " ".join(t.lower() for t in texts if t)
        log.info("smart_capture: OCR tab strip tokens=%r (looking for %r)", joined[:200], sheet_name)
        return None

    except ImportError:
        log.warning("smart_capture: pytesseract not installed; OCR tab navigation unavailable")
        return None
    except Exception as exc:
        log.warning("smart_capture: OCR tab find failed for '%s': %s", sheet_name, exc)
        return None


def _find_tab_via_vision(sheet_name: str, win_rect: tuple[int, int, int, int]) -> tuple[int, int] | None:
    """Ask LM Studio vision model for the screen position of the named tab in the tab strip.

    Returns (screen_x, screen_y) or None if not found / model unavailable.
    """
    try:
        import json as _json, urllib.request as _req
        win_l, win_t, win_r, win_b = win_rect
        tab_bbox = (win_l, win_b - 44, win_r, win_b)
        tab_img = ImageGrab.grab(bbox=tab_bbox)
        b64 = base64.b64encode(_pil_to_bytes(tab_img)).decode()

        prompt = (
            f'This is the tab strip at the bottom of Tableau Desktop. '
            f'Find the tab named exactly "{sheet_name}" (case-insensitive). '
            f'The image is {tab_img.width}×{tab_img.height} px. '
            f'Reply ONLY with JSON: {{"found": true_or_false, "x": pixel_x_of_tab_center}} '
            f'(x is in image pixels, 0=left edge). If not found set found=false and x=0.'
        )
        payload = _json.dumps({
            "model": "google/gemma-3-27b",
            "messages": [{"role": "user", "content": [
                {"type": "text",      "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ]}],
            "max_tokens": 60, "temperature": 0.05,
        }).encode()
        _lm_base = os.environ.get("PERCY_LMSTUDIO_URL", "http://localhost:1234").rstrip("/")
        req = _req.Request(
            f"{_lm_base}/v1/chat/completions",
            data=payload, headers={"Content-Type": "application/json"},
        )
        with _req.urlopen(req, timeout=25) as resp:
            body = _json.loads(resp.read())
        text = body["choices"][0]["message"]["content"].strip()
        m = re.search(r"\{.*?\}", text, re.DOTALL)
        if m:
            jd = _json.loads(m.group())
            if jd.get("found") and jd.get("x"):
                screen_x = win_l + int(jd["x"])
                screen_y = win_b - 22
                log.info("smart_capture: vision tab found '%s' at x=%d", sheet_name, jd["x"])
                return screen_x, screen_y
        return None
    except Exception as exc:
        log.warning("smart_capture: vision tab-find failed for '%s': %s", sheet_name, exc)
        return None


def _prep_capture_twbx(source_path: Path) -> tuple[Path, list[str]]:
    """Create an unhidden copy of the .twbx with all worksheet tabs visible.

    Returns (temp_twbx_path, tab_order) where tab_order lists sheet names
    in the order they will appear in Tableau Desktop's tab strip (from <windows>).
    The temp file is written alongside the source; caller must delete it.
    """
    import zipfile, re, xml.etree.ElementTree as ET

    with zipfile.ZipFile(source_path, "r") as zin:
        twb_name = next(n for n in zin.namelist() if n.endswith(".twb"))
        twb_bytes = zin.read(twb_name)

    xml_str = twb_bytes.decode("utf-8", errors="replace")

    # Extract tab order from <windows> section (this is the order Tableau shows tabs)
    root = ET.fromstring(xml_str)
    windows_el = root.find("windows")
    tab_order: list[str] = []
    if windows_el is not None:
        for w in windows_el:
            cls = w.get("class", "")
            name = w.get("name", "")
            if cls in ("worksheet", "dashboard") and name:
                tab_order.append(name)

    # Remove hidden='true' from <window> elements to make all worksheets visible
    def _strip_hidden(m: re.Match) -> str:
        return m.group(0).replace(" hidden='true'", "")

    xml_str = re.sub(r"<window[^>]+>", _strip_hidden, xml_str)

    # Write temp file in the same directory as source (so Tableau finds any sidecar files)
    temp_path = source_path.with_name("_percy_capture.twbx")
    with zipfile.ZipFile(source_path, "r") as zin:
        with zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = xml_str.encode("utf-8") if item.filename == twb_name else zin.read(item.filename)
                zout.writestr(item, data)

    return temp_path, tab_order


def _dismiss_blocking_dialogs(tableau_hwnd: int) -> None:
    """Close non-Tableau system dialog windows (e.g. OneDrive) that could steal keyboard focus.

    Only targets non-resizable windows (no WS_THICKFRAME) with known blocking titles,
    so browser windows and other main application windows are never closed.
    """
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    WM_CLOSE = 0x0010
    WS_THICKFRAME = 0x00040000  # Resizable windows are main apps, not dialogs

    blockers: list[int] = []

    def _cb(hwnd: int, _: int) -> bool:
        if hwnd == tableau_hwnd or not user32.IsWindowVisible(hwnd):
            return True
        # Skip resizable (main application) windows
        if user32.GetWindowLongW(hwnd, -16) & WS_THICKFRAME:
            return True
        l = user32.GetWindowTextLengthW(hwnd)
        if l <= 0:
            return True
        buf = ctypes.create_unicode_buffer(l + 1)
        user32.GetWindowTextW(hwnd, buf, l + 1)
        title = buf.value.lower()
        if any(k in title for k in ("onedrive", "file recovery")):
            blockers.append(hwnd)
        return True

    user32.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)(_cb), 0)
    for h in blockers:
        log.info("smart_capture: dismissing blocking dialog hwnd=%d", h)
        user32.PostMessageW(wintypes.HWND(h), WM_CLOSE, 0, 0)
        time.sleep(0.3)


def _smart_capture_all_tableau(
    source_path: Path,
    artifacts: list[dict],
    out_dir: Path,
    *,
    wait_sec: int = 60,
    max_render_wait: float = 10.0,
    use_vision: bool = True,
    quality_threshold: float = 14.0,
    max_retries: int = 3,
) -> list[dict]:
    """Open Tableau Desktop once and smart-capture every artifact.

    For each sheet:
      1. Force Tableau window topmost (fixes browser-covers-Tableau capture bug)
      2. Navigate tab by name: OCR → vision-model → keyboard Ctrl+PgDn
      3. Wait for rendering to stabilize (frame-diff analysis)
      4. Pixel quality check — retry with longer wait if too dark/blank
      5. Vision model verify (LM Studio) — final retry if vision rejects
    """
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32

    # Unhide all worksheet tabs so every artifact is keyboard-navigable.
    # This rewrites the <windows> section to remove hidden='true'.
    open_path, tab_order = _prep_capture_twbx(source_path)
    target_stem = open_path.stem.lower()   # "_percy_capture"
    log.info("smart_capture: prep'd unhidden workbook %s (tab_order=%s)", open_path.name, tab_order)

    # Re-order artifacts to match Tableau's tab strip order so keyboard nav is sequential.
    name_to_artifact: dict[str, dict] = {a["name"]: a for a in artifacts}
    sorted_artifacts: list[dict] = []
    for tab_name in tab_order:
        if tab_name in name_to_artifact:
            sorted_artifacts.append(name_to_artifact.pop(tab_name))
    sorted_artifacts.extend(name_to_artifact.values())  # any not in tab_order at the end

    # Kill any existing Tableau processes so we start clean (no file-recovery dialogs).
    import subprocess
    subprocess.run(["taskkill", "/F", "/IM", "tableau.exe"], capture_output=True)
    time.sleep(1.5)

    log.info("smart_capture: opening %s", open_path.name)
    os.startfile(str(open_path))  # type: ignore[attr-defined]

    # Wait for the actual Tableau Desktop workbook window — NOT the "Opening workbook..." loader.
    # The real window title is "Tableau - <WorkbookName>"; loading dialogs start with "Opening".
    hwnd = 0
    win_title = ""
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        for w in _visible_windows(user32):
            if not _is_tableau_window(w):
                continue
            t = w["title"].lower()
            if target_stem not in t:
                continue
            if t.startswith("opening") or t.startswith("tableau - opening"):
                continue  # skip "Opening workbook '...'" loader
            # Verify the window has actual non-zero bounds (not a hidden/unrendered window)
            r = wintypes.RECT()
            user32.GetWindowRect(wintypes.HWND(w["hwnd"]), ctypes.byref(r))
            if r.right - r.left < 100:
                continue
            hwnd = int(w["hwnd"])
            win_title = str(w["title"])
            break
        if hwnd:
            break
        time.sleep(1.5)

    if not hwnd:
        err = (
            f"Timed out waiting for Tableau Desktop to open '{source_path.name}' ({wait_sec}s). "
            "Ensure Tableau Desktop is installed and .twbx files are associated with it."
        )
        return [{"error": err, "slide_number": a["slide_number"], "ok": False} for a in artifacts]

    log.info("smart_capture: found Tableau window hwnd=%s title=%r", hwnd, win_title)

    # Maximize, then force topmost so the browser can't cover it during capture
    user32.ShowWindow(wintypes.HWND(hwnd), 3)  # SW_MAXIMIZE
    time.sleep(2.0)
    _force_hwnd_topmost(hwnd)
    time.sleep(1.0)

    # Dismiss any startup dialogs (File Recovery, license prompts, etc.) with Escape.
    # We press it several times with pauses to handle stacked dialogs.
    import pyautogui
    log.info("smart_capture: dismissing any startup dialogs (Escape ×5)")
    for _ in range(5):
        _force_hwnd_topmost(hwnd)
        time.sleep(0.2)
        pyautogui.press("escape")
        time.sleep(0.4)
    time.sleep(1.0)

    # Read window bounds after maximize
    rect = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect))
    win_l, win_t = int(rect.left), int(rect.top)
    win_r, win_b = int(rect.right), int(rect.bottom)
    win_rect = (win_l, win_t, win_r, win_b)
    log.info("smart_capture: window bounds L=%d T=%d R=%d B=%d", win_l, win_t, win_r, win_b)

    # Content crop: skip Tableau's left data panel, top toolbar, and bottom tab strip
    sidebar_w   = 330   # Tableau left panel (data pane) is ~330px wide when maximized
    toolbar_h   = 120   # Top toolbar + menu bar
    tab_strip_h = 50    # Bottom tab strip

    # Title bar click: safe focus point that does not trigger dashboard navigation actions.
    # Use win_t+25 to stay well away from the screen top (avoids Windows Snap triggers at y≈0).
    title_click_x = win_l + 600
    title_click_y = win_t + 25
    log.info("smart_capture: title bar focus click target (%d, %d)", title_click_x, title_click_y)

    def _grab() -> Image.Image:
        """Capture Tableau content area. Re-reads window bounds each call so a window
        move/restore after the initial bbox computation doesn't produce desktop screenshots."""
        # Restore window if it got minimized
        if user32.IsIconic(wintypes.HWND(hwnd)):
            user32.ShowWindow(wintypes.HWND(hwnd), 3)  # SW_MAXIMIZE
            time.sleep(1.0)
        _force_hwnd_topmost(hwnd)
        # Re-read current window position — title-bar click or OS snap may have moved it
        _r = wintypes.RECT()
        user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(_r))
        _l2, _t2, _r2, _b2 = int(_r.left), int(_r.top), int(_r.right), int(_r.bottom)
        _bbox = (_l2 + sidebar_w, _t2 + toolbar_h, _r2, _b2 - tab_strip_h)
        time.sleep(0.25)  # Let DWM composite the window before grabbing
        return ImageGrab.grab(bbox=_bbox)

    # One-time focus: click the window title bar (safe — does not trigger sheet navigation).
    # Tableau opens to the first sheet in the <windows> section (sorted_artifacts[0]).
    # After this single click, we use ONLY keyboard for all navigation (no further clicks).
    import pyautogui
    _force_hwnd_topmost(hwnd)
    _dismiss_blocking_dialogs(hwnd)
    time.sleep(0.2)
    _mouse_click_screen(title_click_x, title_click_y)
    time.sleep(0.8)
    # Verify Tableau is still foreground; if the click moved the window, re-read bounds
    _r_check = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(_r_check))
    win_l2, win_t2, win_r2, win_b2 = int(_r_check.left), int(_r_check.top), int(_r_check.right), int(_r_check.bottom)
    if (win_l2, win_t2, win_r2, win_b2) != (win_l, win_t, win_r, win_b):
        log.warning("smart_capture: window moved after focus click: %d,%d→%d,%d (was %d,%d→%d,%d) — re-maximizing",
                    win_l2, win_t2, win_r2, win_b2, win_l, win_t, win_r, win_b)
        user32.ShowWindow(wintypes.HWND(hwnd), 3)  # SW_MAXIMIZE
        time.sleep(1.0)
        _force_hwnd_topmost(hwnd)
        time.sleep(0.3)

    results: list[dict] = []
    current_tab_idx = 0  # Tableau opens to sorted_artifacts[0] (first sheet in <windows>)

    for i, artifact in enumerate(sorted_artifacts):
        sn   = artifact["slide_number"]
        name = artifact["name"]
        kind = artifact["kind"]
        out_path = out_dir / f"artifact-{sn:03d}.png"

        log.info("smart_capture: [%d/%d] navigating to '%s' (%s)", i + 1, len(sorted_artifacts), name, kind)
        _force_hwnd_topmost(hwnd)
        _dismiss_blocking_dialogs(hwnd)

        nav_method = "none"

        # ── Strategy 1: Tesseract OCR click on visible tab ───────────────────
        ocr_pos = _find_tab_via_ocr(name, win_rect)
        if ocr_pos:
            _mouse_click_screen(*ocr_pos)
            nav_method = "ocr"
            current_tab_idx = i
            log.info("smart_capture: OCR tab click for '%s' at %s", name, ocr_pos)

        # ── Strategy 2: pure keyboard navigation (no intermediate clicks) ────
        # Ctrl+PgDn/PgUp retains focus from the initial title bar click and
        # works reliably across all 23 tabs without any canvas re-clicking.
        if nav_method == "none":
            steps = i - current_tab_idx
            if steps != 0:
                _force_hwnd_topmost(hwnd)
                time.sleep(0.05)
                if steps > 0:
                    log.info("smart_capture: keyboard nav — Ctrl+PgDn ×%d for '%s'", steps, name)
                    for _ in range(steps):
                        pyautogui.hotkey("ctrl", "pagedown")
                        time.sleep(0.15)
                else:
                    log.info("smart_capture: keyboard nav — Ctrl+PgUp ×%d for '%s'", -steps, name)
                    for _ in range(-steps):
                        pyautogui.hotkey("ctrl", "pageup")
                        time.sleep(0.15)

            current_tab_idx = i
            nav_method = "keyboard"

        # Give Tableau time to load chart data from the extract before grabbing.
        # Without this wait, the blank white canvas (no chart rendered yet) stabilises
        # in <1 s and gets saved as a blank screenshot. 5 s covers typical extract query
        # times for worksheets with 400K-row datasets.
        # Also send Escape to dismiss any tooltip/overlay that might cover the viz.
        _force_hwnd_topmost(hwnd)
        pyautogui.press("escape")
        time.sleep(0.15)
        pyautogui.press("escape")
        time.sleep(5.0)

        # Capture with stability wait + quality check + optional vision verify
        capture_meta = _smart_capture_one(
            _grab, out_path, name,
            max_render_wait=max_render_wait,
            quality_threshold=quality_threshold,
            max_retries=max_retries,
            use_vision=use_vision,
        )

        results.append({
            "slide_number": sn,
            "name":         name,
            "kind":         kind,
            "path":         str(out_path),
            "nav_method":   nav_method,
            **capture_meta,
        })

        q   = capture_meta.get("quality_score", 0)
        vok = capture_meta.get("vision", {}).get("ok", "n/a")
        log.info("smart_capture: '%s' quality=%.1f vision=%s nav=%s", name, q, vok, nav_method)

    _restore_hwnd_notopmost(hwnd)

    # Clean up the temp unhidden workbook
    try:
        open_path.unlink(missing_ok=True)
    except Exception:
        pass

    return results


def _capture_all_tableau_sheets(
    source_path: Path,
    artifacts: list[dict],
    out_dir: Path,
    wait_sec: int = 60,
    render_wait: float = 2.0,
) -> list[dict]:
    """Open Tableau Desktop once, cycle through every tab with Ctrl+PgDn, screenshot each."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    target_stem = source_path.stem.lower()

    # Open the workbook via shell association
    os.startfile(str(source_path))  # type: ignore[attr-defined]

    # Wait for a Tableau Desktop window (verified by process name, not just title)
    hwnd = 0
    title = ""
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        candidates = [
            w for w in _visible_windows(user32)
            if _is_tableau_window(w) and target_stem in w["title"].lower()
        ]
        if candidates:
            hwnd = int(candidates[0]["hwnd"])
            title = str(candidates[0]["title"])
            break
        time.sleep(1.0)

    if not hwnd:
        err = (
            f"Timed out waiting for Tableau Desktop to open '{source_path.name}' ({wait_sec}s). "
            "Ensure Tableau Desktop is installed and .twbx files are associated with it."
        )
        return [{"error": err, "slide_number": a["slide_number"]} for a in artifacts]

    # Maximize for consistent layout
    SW_MAXIMIZE = 3
    user32.ShowWindow(wintypes.HWND(hwnd), SW_MAXIMIZE)
    user32.SetForegroundWindow(wintypes.HWND(hwnd))
    time.sleep(render_wait)

    # Navigate to the first sheet by name
    first_name = artifacts[0]["name"]
    _navigate_to_tableau_sheet(user32, hwnd, first_name)
    time.sleep(render_wait)

    # Compute content crop from maximized window bounds
    rect = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect))
    win_l, win_t, win_r, win_b = int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)

    # Tableau layout (maximized): left data panel ~240px, top toolbar ~90px, bottom tabs ~34px
    sidebar_w = 240
    toolbar_h = 90
    tab_strip_h = 34
    content_l = win_l + sidebar_w
    content_t = win_t + toolbar_h
    content_r = win_r
    content_b = win_b - tab_strip_h

    results = []
    for i, artifact in enumerate(artifacts):
        sn = artifact["slide_number"]
        name = artifact["name"]
        kind = artifact["kind"]

        if i > 0:
            _send_ctrl_pgdn(user32, hwnd)
            time.sleep(render_wait)

        out_path = out_dir / f"artifact-{sn:03d}.png"
        try:
            img = ImageGrab.grab(bbox=(content_l, content_t, content_r, content_b))
            img.save(out_path)
            results.append({"slide_number": sn, "name": name, "kind": kind, "path": str(out_path), "ok": True})
        except Exception as exc:
            results.append({"slide_number": sn, "name": name, "kind": kind, "error": str(exc), "ok": False})

    return results


def _capture_tableau_artifact_window(
    source_path: Path,
    artifact_name: str,
    artifact_kind: str,
    out_path: Path,
    wait_sec: int = 60,
) -> dict[str, Any]:
    """Open Tableau Desktop, navigate to a specific worksheet/dashboard tab, and screenshot it."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    target_stem = source_path.stem.lower()

    # Open the workbook
    os.startfile(str(source_path))  # type: ignore[attr-defined]

    # Wait for a real Tableau Desktop window (verified by process exe name)
    hwnd = 0
    title = ""
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        candidates = [
            w for w in _visible_windows(user32)
            if _is_tableau_window(w) and target_stem in w["title"].lower()
        ]
        if candidates:
            hwnd = int(candidates[0]["hwnd"])
            title = str(candidates[0]["title"])
            break
        time.sleep(1)

    if not hwnd:
        raise HTTPException(
            504,
            f"Timed out waiting for Tableau Desktop to open '{source_path.name}'. "
            "Ensure Tableau Desktop is installed and .twbx files are associated with it.",
        )

    user32.SetForegroundWindow(wintypes.HWND(hwnd))
    time.sleep(2.0)  # Allow full render

    # Try to navigate to the specific sheet tab by name
    _navigate_to_tableau_sheet(user32, hwnd, artifact_name)
    time.sleep(1.0)  # Allow tab switch to render

    # Get window bounds
    rect = wintypes.RECT()
    if not user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect)):
        raise HTTPException(500, "Could not read Tableau window bounds")
    width = int(rect.right - rect.left)
    height = int(rect.bottom - rect.top)

    # Estimate Tableau's content area: skip left panel (~240px) and top toolbar (~90px)
    # The sheet tabs are at the bottom (~30px). Adjust based on window size.
    sidebar_w = min(250, width // 6)
    toolbar_h = min(90, height // 10)
    tab_strip_h = 30
    content_bbox = (
        int(rect.left) + sidebar_w,
        int(rect.top) + toolbar_h,
        int(rect.right),
        int(rect.bottom) - tab_strip_h,
    )

    image = ImageGrab.grab(bbox=content_bbox)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path)

    return {
        "path": str(out_path),
        "title": title,
        "artifact_name": artifact_name,
        "artifact_kind": artifact_kind,
        "window_width": width,
        "window_height": height,
        "content_bbox": list(content_bbox),
        "source": str(source_path),
        "mode": "tableau_desktop_artifact_capture",
    }


def _navigate_to_tableau_sheet(user32: Any, hwnd: int, sheet_name: str) -> bool:
    """Try to navigate Tableau Desktop to a named sheet tab via child-window enumeration."""
    import ctypes
    from ctypes import wintypes

    found_hwnd = 0
    enum_proc_type = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def callback(child_hwnd: Any, _lparam: Any) -> bool:
        nonlocal found_hwnd
        length = user32.GetWindowTextLengthW(child_hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(child_hwnd, buf, length + 1)
        text = buf.value.strip()
        if text.lower() == sheet_name.lower():
            found_hwnd = int(child_hwnd)
            return False  # stop enumeration
        return True

    user32.EnumChildWindows(wintypes.HWND(hwnd), enum_proc_type(callback), 0)

    if found_hwnd:
        WM_LBUTTONDOWN = 0x0201
        WM_LBUTTONUP = 0x0202
        user32.SendMessageW(wintypes.HWND(found_hwnd), WM_LBUTTONDOWN, 0, 0)
        user32.SendMessageW(wintypes.HWND(found_hwnd), WM_LBUTTONUP, 0, 0)
        return True

    # Fallback: Tableau sheet tabs may not appear as standard child windows.
    # Try Ctrl+Tab cycling to find the sheet by looking at window title changes.
    return False


def _capture_tableau_desktop_window(source_path: Path, out_path: Path, wait_sec: int = 45) -> dict[str, Any]:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    target = source_path.stem.lower()

    # Shell/file association is the reliable path for Tableau Desktop here;
    # direct tableau.exe <file> launches Book1 on this machine.
    os.startfile(str(source_path))  # type: ignore[attr-defined]

    hwnd = 0
    title = ""
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        candidates = [
            w for w in _visible_windows(user32)
            if _is_tableau_window(w) and target in w["title"].lower()
        ]
        if candidates:
            hwnd = int(candidates[0]["hwnd"])
            title = str(candidates[0]["title"])
            break
        time.sleep(1)

    if not hwnd:
        raise HTTPException(
            504,
            f"Timed out waiting for Tableau Desktop to open '{source_path.name}'. "
            "Ensure Tableau Desktop is installed and .twbx files are associated with it.",
        )

    user32.SetForegroundWindow(wintypes.HWND(hwnd))
    time.sleep(2)

    rect = wintypes.RECT()
    if not user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(rect)):
        raise HTTPException(500, "Could not read Tableau window bounds")
    width = int(rect.right - rect.left)
    height = int(rect.bottom - rect.top)
    if width <= 0 or height <= 0:
        raise HTTPException(500, f"Invalid Tableau window bounds: {width}x{height}")

    image = ImageGrab.grab(bbox=(int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)))
    image.save(out_path)
    return {
        "path": str(out_path),
        "title": title,
        "width": width,
        "height": height,
        "left": int(rect.left),
        "top": int(rect.top),
        "source": str(source_path),
        "mode": "tableau_desktop_window_capture",
    }


def _get_hwnd_exe(hwnd: Any) -> str:
    """Return the lowercase exe filename for the process that owns hwnd, or ''."""
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.windll.kernel32
    pid = wintypes.DWORD(0)
    ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value:
        return ""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    hproc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if not hproc:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(512)
        size = wintypes.DWORD(512)
        kernel32.QueryFullProcessImageNameW(hproc, 0, buf, ctypes.byref(size))
        return Path(buf.value).name.lower() if buf.value else ""
    finally:
        kernel32.CloseHandle(hproc)


def _visible_windows(user32: Any) -> list[dict[str, Any]]:
    import ctypes
    from ctypes import wintypes

    windows: list[dict[str, Any]] = []
    enum_proc_type = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def callback(hwnd: Any, _lparam: Any) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        title = buffer.value.strip()
        if title:
            windows.append({"hwnd": int(hwnd), "title": title, "exe": _get_hwnd_exe(hwnd)})
        return True

    user32.EnumWindows(enum_proc_type(callback), 0)
    return windows


_TABLEAU_EXE_NAMES = {"tableau.exe", "tableaupublic.exe", "tableaudesktop.exe"}


def _is_tableau_window(w: dict[str, Any]) -> bool:
    """True only if the window belongs to a real Tableau Desktop process."""
    return w.get("exe", "") in _TABLEAU_EXE_NAMES


def _send_ctrl_pgdn(user32: Any, hwnd: int, canvas_xy: tuple[int, int] | None = None) -> None:
    """Send Ctrl+PgDn to navigate to the next Tableau tab."""
    import pyautogui
    _force_hwnd_topmost(hwnd)
    time.sleep(0.05)
    pyautogui.hotkey("ctrl", "pagedown")


# ─── Route handlers ──────────────────────────────────────────────────────────

def _register_routes(app: FastAPI) -> None:
    @app.get("/api/docs/{doc_id}/tableau")
    def get_tableau(doc_id: str):
        _resolve_main_helpers()
        return _tableau_payload(_require(doc_id))


    @app.get("/api/docs/{doc_id}/tableau/images/{image_index}")
    def get_tableau_image(doc_id: str, image_index: int):
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("source_format") != "tableau":
            raise HTTPException(400, "Document is not a Tableau workbook")
        tableau = (d["doc"].custom_properties or {}).get("tableau", {})
        images = tableau.get("packaged_images", [])
        if image_index < 0 or image_index >= len(images):
            raise HTTPException(404, f"Tableau packaged image {image_index} out of range")
        image = images[image_index]
        source_path = Path(d["source_path"])
        if source_path.suffix.lower() != ".twbx":
            raise HTTPException(404, "Packaged Tableau images only exist for .twbx files")
        image_path = str(image.get("path") or "").replace("\\", "/")
        if not image_path:
            raise HTTPException(404, "Packaged image path is missing")
        try:
            with zipfile.ZipFile(source_path) as package:
                payload = package.read(image_path)
        except KeyError:
            raise HTTPException(404, f"Packaged image not found: {image_path}")
        media_type = "image/jpeg" if str(image.get("format", "")).lower() in {"jpg", "jpeg"} else "image/png"
        return Response(content=payload, media_type=media_type, headers={"Cache-Control": "max-age=60"})


    @app.post("/api/docs/{doc_id}/tableau/native-screenshot")
    def capture_tableau_native_screenshot(doc_id: str, wait_sec: int = 45):
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("source_format") != "tableau":
            raise HTTPException(400, "Document is not a Tableau workbook")
        if sys.platform != "win32":
            raise HTTPException(400, "Native Tableau screenshot capture currently requires Windows/Tableau Desktop")
        source_path = Path(d["source_path"])
        if not source_path.exists():
            raise HTTPException(404, f"Source workbook missing: {source_path}")

        out_dir = _CACHE_DIR / doc_id / "tableau-native"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / "native-window.png"
        result = _capture_tableau_desktop_window(source_path, out_path, wait_sec=max(5, min(wait_sec, 120)))
        d["tableau_native_screenshot"] = str(out_path)
        _record_event(
            d["source_path"], d["name"], "tableau", d["slide_count"],
            "native_tableau_screenshot",
            f"Captured Tableau Desktop window: {result.get('title')}",
            {"doc_id": doc_id, **result},
            "ok",
        )
        _update_history_snapshot(doc_id)
        return result


    @app.get("/api/docs/{doc_id}/tableau/native-screenshot.png")
    def get_tableau_native_screenshot(doc_id: str):
        _resolve_main_helpers()
        d = _require(doc_id)
        path = d.get("tableau_native_screenshot")
        if not path:
            raise HTTPException(404, "Native Tableau screenshot has not been captured yet")
        p = Path(path)
        if not p.exists():
            raise HTTPException(404, f"Native Tableau screenshot missing: {p}")
        return FileResponse(str(p), media_type="image/png", headers={"Cache-Control": "max-age=30"})


    @app.post("/api/docs/{doc_id}/tableau/artifacts/{artifact_n}/capture")
    def capture_tableau_artifact(doc_id: str, artifact_n: int, wait_sec: int = 60):
        """Open Tableau Desktop, navigate to a specific worksheet/artifact, and capture a screenshot."""
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("source_format") != "tableau":
            raise HTTPException(400, "Document is not a Tableau workbook")
        if sys.platform != "win32":
            raise HTTPException(400, "Native Tableau screenshot capture requires Windows/Tableau Desktop")
        source_path = Path(d["source_path"])
        if not source_path.exists():
            raise HTTPException(404, f"Source workbook missing: {source_path}")

        # Find the artifact name for this slide number
        doc = d["doc"]
        artifact_slide = next((s for s in doc.slides if s.slide_number == artifact_n), None)
        if artifact_slide is None:
            raise HTTPException(404, f"Artifact {artifact_n} not found in document")

        props = artifact_slide.custom_properties or {}
        tab_info = props.get("tableau", {}) or {}
        artifact_name = tab_info.get("name") or tab_info.get("title") or f"Artifact {artifact_n}"
        artifact_kind = props.get("tableau_kind", "artifact")

        out_dir = _CACHE_DIR / doc_id / "tableau-artifacts"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"artifact-{artifact_n:03d}.png"

        result = _capture_tableau_artifact_window(
            source_path, artifact_name, artifact_kind, out_path,
            wait_sec=max(5, min(wait_sec, 120)),
        )

        # Cache per-artifact path in doc state
        artifact_captures = d.setdefault("tableau_artifact_captures", {})
        artifact_captures[artifact_n] = str(out_path)

        _record_event(
            d["source_path"], d["name"], "tableau", d["slide_count"],
            "tableau_artifact_capture",
            f"Captured Tableau artifact {artifact_n}: {artifact_name}",
            {"doc_id": doc_id, "artifact_n": artifact_n, "artifact_name": artifact_name, **result},
            "ok",
        )
        _update_history_snapshot(doc_id)
        return result


    @app.get("/api/docs/{doc_id}/tableau/artifacts/{artifact_n}/capture.png")
    def get_tableau_artifact_capture(doc_id: str, artifact_n: int):
        _resolve_main_helpers()
        d = _require(doc_id)
        captures = d.get("tableau_artifact_captures", {})
        path = captures.get(artifact_n)
        if not path:
            raise HTTPException(404, f"No capture for artifact {artifact_n} — call POST first")
        p = Path(path)
        if not p.exists():
            raise HTTPException(404, f"Capture image missing: {p}")
        return FileResponse(str(p), media_type="image/png", headers={"Cache-Control": "max-age=30"})


    @app.post("/api/docs/{doc_id}/tableau/capture-all")
    def capture_all_tableau_sheets(doc_id: str, wait_sec: int = 60, render_wait: float = 2.0):
        """Open Tableau Desktop once and screenshot every worksheet and dashboard in order.

        Navigates via Ctrl+PgDn cycling — no per-sheet Tableau instance needed.
        Returns a mapping of slide_number → capture path.
        """
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("source_format") != "tableau":
            raise HTTPException(400, "Document is not a Tableau workbook")
        if sys.platform != "win32":
            raise HTTPException(400, "Requires Windows + Tableau Desktop")
        source_path = Path(d["source_path"])
        if not source_path.exists():
            raise HTTPException(404, f"Source workbook missing: {source_path}")

        doc = d["doc"]
        # Collect ordered artifacts (worksheets then dashboards, as they appear in the TWB tab strip)
        artifacts = []
        for slide in doc.slides:
            props = slide.custom_properties or {}
            kind = props.get("tableau_kind")
            if kind not in {"worksheet", "dashboard"}:
                continue
            info = props.get("tableau", {}) or {}
            name = info.get("name") or info.get("title") or f"Sheet {slide.slide_number}"
            artifacts.append({"slide_number": slide.slide_number, "name": name, "kind": kind})

        if not artifacts:
            raise HTTPException(400, "No worksheet or dashboard artifacts found in this document")

        out_dir = _CACHE_DIR / doc_id / "tableau-artifacts"
        out_dir.mkdir(parents=True, exist_ok=True)

        results = _capture_all_tableau_sheets(
            source_path, artifacts, out_dir,
            wait_sec=max(10, min(wait_sec, 180)),
            render_wait=max(0.5, min(render_wait, 10.0)),
        )

        # Cache results per artifact_n
        artifact_captures = d.setdefault("tableau_artifact_captures", {})
        captured_count = 0
        for r in results:
            sn = r.get("slide_number")
            path = r.get("path")
            if sn and path and Path(path).exists():
                artifact_captures[sn] = path
                captured_count += 1

        _record_event(
            d["source_path"], d["name"], "tableau", d["slide_count"],
            "tableau_capture_all",
            f"Batch-captured {captured_count}/{len(artifacts)} sheets from Tableau Desktop",
            {"doc_id": doc_id, "captured": captured_count, "total": len(artifacts)},
            "ok",
        )
        _update_history_snapshot(doc_id)
        return {"captured": captured_count, "total": len(artifacts), "results": results}


    @app.post("/api/docs/{doc_id}/tableau/smart-capture-all")
    def smart_capture_all_tableau_sheets(
        doc_id: str,
        wait_sec: int = 60,
        max_render_wait: float = 10.0,
        use_vision: bool = True,
        quality_threshold: float = 14.0,
        max_retries: int = 3,
    ):
        """Smart batch Tableau capture with stability detection, quality checks, and vision verification."""
        _resolve_main_helpers()
        d = _require(doc_id)
        if d.get("source_format") != "tableau":
            raise HTTPException(400, "Document is not a Tableau workbook")
        if sys.platform != "win32":
            raise HTTPException(400, "Requires Windows + Tableau Desktop")
        source_path = Path(d["source_path"])
        if not source_path.exists():
            raise HTTPException(404, f"Source workbook missing: {source_path}")

        doc = d["doc"]
        artifacts: list[dict] = []
        for slide in doc.slides:
            props = slide.custom_properties or {}
            kind  = props.get("tableau_kind")
            if kind not in {"worksheet", "dashboard"}:
                continue
            info = props.get("tableau", {}) or {}
            name = info.get("name") or info.get("title") or f"Sheet {slide.slide_number}"
            artifacts.append({"slide_number": slide.slide_number, "name": name, "kind": kind})

        if not artifacts:
            raise HTTPException(400, "No worksheet or dashboard artifacts found")

        out_dir = _CACHE_DIR / doc_id / "tableau-artifacts"
        out_dir.mkdir(parents=True, exist_ok=True)

        results = _smart_capture_all_tableau(
            source_path, artifacts, out_dir,
            wait_sec=max(10, min(wait_sec, 300)),
            max_render_wait=max(2.0, min(max_render_wait, 60.0)),
            use_vision=use_vision,
            quality_threshold=quality_threshold,
            max_retries=max(1, min(max_retries, 5)),
        )

        artifact_captures = d.setdefault("tableau_artifact_captures", {})
        captured_count = 0
        for r in results:
            sn   = r.get("slide_number")
            path = r.get("path")
            if sn and path and Path(path).exists():
                artifact_captures[sn] = path
                captured_count += 1

        _record_event(
            d["source_path"], d["name"], "tableau", d["slide_count"],
            "tableau_smart_capture_all",
            f"Smart-captured {captured_count}/{len(artifacts)} sheets with quality verification",
            {"doc_id": doc_id, "captured": captured_count, "total": len(artifacts),
             "use_vision": use_vision},
            "ok",
        )
        _update_history_snapshot(doc_id)
        return {"captured": captured_count, "total": len(artifacts), "results": results}


def _resolve_main_helpers() -> None:
    """Resolve shared helpers from main.py — called lazily per request to avoid
    circular import / definition-order issues (main.py defines these helpers
    AFTER it calls register_tableau_router())."""
    global _require, _record_event, _update_history_snapshot, _tableau_payload, _CACHE_DIR
    if _require is not None:
        return
    from app.backend import main as _main
    _require = _main._require
    _record_event = _main._record_event
    _update_history_snapshot = _main._update_history_snapshot
    _tableau_payload = _main._tableau_payload
    _CACHE_DIR = _main._CACHE_DIR


def register_tableau_router(app: FastAPI) -> None:
    """Register all Tableau routes onto the FastAPI app.

    Shared main-module helpers are resolved lazily on first request to avoid
    import-time ordering issues.
    """
    _register_routes(app)
