"""Percy script_api SDK — the surface scripts see at runtime.

Live-group generator scripts and slide-level scripts use this module to
author and edit elements. The SDK is a thin wrapper that emits HTTP calls
back into the studio API; the actual mutations happen server-side.

Decoupling scripts from raw Bridge dataclasses means:
  * agent-generated scripts are short and obvious
  * humans hand-writing scripts see the same surface
  * Bridge schema changes don't break user scripts

Usage inside a script::

    def generate(group, inputs, studio):
        for i, day in enumerate(inputs["dates"]):
            group.add_child("shape", {
                "geometry_preset": "rect",
                "position": {"left_in": i * 0.5, "top_in": 0,
                             "width_in": 0.45, "height_in": 0.6},
                "fill_color": "accent1" if day["status"] == "done" else "accent1 +60%",
                "text": day["label"],
            })

    def run(slide, inputs, studio):
        for el in slide.find_all(type="BridgeShape"):
            if not el.text:
                el.hide()

The runner ``percy.agent.sandbox`` injects `studio`, `slide`, `group` (or
whatever entry-point context is appropriate) before calling the script's
``generate`` / ``run`` function.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


# ── Studio HTTP client ──────────────────────────────────────────────────────


class StudioError(RuntimeError):
    pass


class Studio:
    """HTTP client used inside scripts. Calls the studio API on the user's behalf.

    Two transport modes:
      * ``base_url=http://...`` — real HTTP via urllib (production, separate process)
      * ``asgi_app=<FastAPI app>`` — in-process via httpx ASGITransport
        (used by the agent's chat endpoint to call itself without paying TCP cost
        and to work under TestClient where ``testserver`` isn't network-routable)
    """

    def __init__(self, base_url: str | None = None, doc_id: str = "",
                 auth_token: str | None = None,
                 *, timeout_s: float = 10.0, asgi_app: Any = None):
        self.base_url = (base_url or "").rstrip("/") or "http://testserver"
        self.doc_id = doc_id
        self.timeout_s = timeout_s
        self.asgi_app = asgi_app
        self._headers = {"Content-Type": "application/json"}
        if auth_token:
            self._headers["Cookie"] = f"percy_session={auth_token}"

        # In-process ASGI client (Starlette TestClient under the hood) when an
        # app is provided. Lets the chat endpoint call back into itself without
        # a TCP roundtrip and without depending on the host being routable.
        self._asgi_client = None
        if asgi_app is not None:
            try:
                from starlette.testclient import TestClient as _TC
                self._asgi_client = _TC(asgi_app)
                if auth_token:
                    self._asgi_client.cookies.set("percy_session", auth_token)
            except ImportError:
                self._asgi_client = None

        # Operation log — every call is appended here for the runner to surface.
        self.ops: list[dict] = []

    # ── Element creation ────────────────────────────────────────────────

    def create_element(self, slide_n: int, kind: str, body: dict) -> dict:
        """kind: 'shape' | 'text' | 'chart' | 'table' | 'connector' | 'freeform' | 'image-typed' | 'live-group'"""
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements/{kind}"
        result = self._post(path, body)
        self.ops.append({"op": "create", "kind": kind, "slide_n": slide_n,
                         "element_id": result.get("id"), "name": result.get("name")})
        return result

    def insert_bridge_raw(self, slide_n: int, bridge_dict: dict) -> dict:
        """Insert a fully-formed BridgeElement (from bridge_to_dict) onto a slide.

        Preserves every nested attribute exactly — used by the v3 template
        induction pipeline's 1:1 fidelity path.
        """
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements/bridge-raw"
        result = self._post(path, bridge_dict)
        self.ops.append({"op": "insert_bridge_raw",
                         "kind": bridge_dict.get("__type__"),
                         "slide_n": slide_n,
                         "element_id": result.get("id"),
                         "name": result.get("name")})
        return result

    # ── Element edit ────────────────────────────────────────────────────

    def patch_element(self, slide_n: int, element_id: str, body: dict) -> dict:
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements/{element_id}"
        result = self._patch(path, body)
        self.ops.append({"op": "patch", "slide_n": slide_n, "element_id": element_id, "body": body})
        return result

    def patch_chart_data(self, slide_n: int, element_id: str, body: dict) -> dict:
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements/{element_id}/chart-data"
        result = self._patch(path, body)
        self.ops.append({"op": "patch_chart", "slide_n": slide_n, "element_id": element_id})
        return result

    def patch_table_data(self, slide_n: int, element_id: str, body: dict) -> dict:
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements/{element_id}/table-data"
        result = self._patch(path, body)
        self.ops.append({"op": "patch_table", "slide_n": slide_n, "element_id": element_id})
        return result

    def patch_style(self, slide_n: int, element_id: str, body: dict) -> dict:
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements/{element_id}/style"
        result = self._patch(path, body)
        self.ops.append({"op": "patch_style", "slide_n": slide_n, "element_id": element_id})
        return result

    def patch_text(self, slide_n: int, element_id: str, body: dict) -> dict:
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements/{element_id}/text"
        result = self._patch(path, body)
        self.ops.append({"op": "patch_text", "slide_n": slide_n, "element_id": element_id})
        return result

    def delete_element(self, slide_n: int, element_id: str) -> dict:
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements/{element_id}"
        result = self._delete(path)
        self.ops.append({"op": "delete", "slide_n": slide_n, "element_id": element_id})
        return result

    def find_element(self, query: str, *, viewing_slide_n: int | None = None,
                     selected_element_id: str | None = None,
                     scope: Any = None,
                     element_types: list[str] | None = None,
                     limit: int = 5) -> dict:
        body = {"doc_id": self.doc_id, "query": query, "limit": limit,
                "context": {"viewing_slide_n": viewing_slide_n,
                            "selected_element_id": selected_element_id,
                            "scope": scope, "element_types": element_types}}
        return self._post("/api/agent/find_element", body)

    # ── Slide ops ───────────────────────────────────────────────────────

    def list_elements(self, slide_n: int) -> list[dict]:
        path = f"/api/docs/{self.doc_id}/slides/{slide_n}/elements"
        return self._get(path).get("elements", [])

    def add_slide(self, after_n: int = 0) -> int:
        """Insert a blank slide after `after_n` (0 = append). Returns the new
        slide's 1-based index. Used by codegen-emitted slide builder functions.
        """
        path = f"/api/docs/{self.doc_id}/slides"
        if after_n:
            path = f"{path}?after_n={int(after_n)}"
        result = self._post(path, {})
        n = int(result.get("slide_number") or result.get("n") or 0)
        self.ops.append({"op": "add_slide", "slide_n": n})
        return n

    # ── Typed convenience wrappers (used by generated brand modules) ─────
    #
    # All return the created element's id. The generic create_element() is
    # equivalent; these are sugar that reads better in auto-generated code:
    #
    #   studio.create_text(slide_n, {"text": "Hi", ...})
    #
    # vs
    #
    #   studio.create_element(slide_n, "text", {"text": "Hi", ...})

    def create_text(self, slide_n: int, body: dict) -> str:
        return self.create_element(slide_n, "text", body).get("id", "")

    def create_shape(self, slide_n: int, body: dict) -> str:
        return self.create_element(slide_n, "shape", body).get("id", "")

    def create_chart(self, slide_n: int, body: dict) -> str:
        return self.create_element(slide_n, "chart", body).get("id", "")

    def create_table(self, slide_n: int, body: dict) -> str:
        return self.create_element(slide_n, "table", body).get("id", "")

    def create_connector(self, slide_n: int, body: dict) -> str:
        return self.create_element(slide_n, "connector", body).get("id", "")

    def create_image(self, slide_n: int, body: dict) -> str:
        return self.create_element(slide_n, "image-typed", body).get("id", "")

    def create_live_group(self, slide_n: int, body: dict) -> str:
        return self.create_element(slide_n, "live-group", body).get("id", "")

    # ── HTTP plumbing ───────────────────────────────────────────────────

    def _post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, body)

    def _patch(self, path: str, body: dict) -> dict:
        return self._request("PATCH", path, body)

    def _put(self, path: str, body: dict) -> dict:
        return self._request("PUT", path, body)

    def _delete(self, path: str) -> dict:
        return self._request("DELETE", path, None)

    def _get(self, path: str) -> dict:
        return self._request("GET", path, None)

    def _request(self, method: str, path: str, body: dict | None) -> dict:
        # In-process ASGI path — preferred when an app is registered.
        if self._asgi_client is not None:
            try:
                kw = {"json": body} if body is not None else {}
                resp = self._asgi_client.request(method, path, **kw)
            except Exception as exc:
                raise StudioError(f"{method} {path} -> ASGI {type(exc).__name__}: {exc}")
            if resp.status_code >= 400:
                raise StudioError(f"{method} {path} -> {resp.status_code}: {resp.text[:300]}")
            try:
                return resp.json()
            except Exception:
                return {"_raw": resp.text}

        # Real HTTP path
        url = self.base_url + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=self._headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
                raw = r.read()
        except urllib.error.HTTPError as exc:
            raise StudioError(f"{method} {path} -> {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}")
        except Exception as exc:
            raise StudioError(f"{method} {path} -> {type(exc).__name__}: {exc}")
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            return {"_raw": raw.decode("utf-8", "replace")}


# ── GroupHandle — lightweight proxy for live-group generators ──────────────


class GroupHandle:
    """Proxy passed to a live-group generator script as ``group``.

    Methods queue child specs; the runner harvests them after the script
    finishes and passes them to the executor for batch creation.

    Why batch instead of immediate calls? Two reasons:
      1. The runner can apply locked-child preservation (option C) all at
         once — diff old vs new and selectively replace.
      2. The script is ergonomic — `group.add_child(...)` doesn't block
         on HTTP per child.
    """

    def __init__(self, slide_n: int, position: dict, inputs: dict, *,
                 existing_children: list[dict] | None = None):
        self.slide_n = slide_n
        self.position = position
        self.width = position.get("width_in", 0.0)
        self.height = position.get("height_in", 0.0)
        self.left = position.get("left_in", 0.0)
        self.top = position.get("top_in", 0.0)
        self.inputs = inputs
        self.children_spec: list[dict] = []
        self.existing = list(existing_children or [])

    def add_child(self, kind: str, body: dict, *, locked: bool = False) -> None:
        """Queue a child element to be created in this group.

        kind: 'shape' | 'text' | 'chart' | 'table' | 'connector' | 'freeform'
        locked: if True, marked user_locked so future regenerates leave it alone.
        """
        spec = {"kind": kind, "body": dict(body), "locked": bool(locked)}
        self.children_spec.append(spec)

    def existing_locked(self) -> list[dict]:
        """Return existing children with user_locked=True (option C semantics).

        The script can use this to position around already-locked children.
        """
        return [c for c in self.existing if c.get("user_locked")]


# ── SlideHandle — proxy for slide-level scripts ────────────────────────────


class SlideHandle:
    """Proxy passed to a slide-level script as ``slide``.

    Backed by a Studio client; methods translate to HTTP calls. Scripts can
    iterate elements, hide/show, restyle, etc.
    """

    def __init__(self, studio: Studio, slide_n: int):
        self._studio = studio
        self.slide_n = slide_n
        # Cached on first access.
        self._elements: list[ElementHandle] | None = None

    @property
    def elements(self) -> list["ElementHandle"]:
        if self._elements is None:
            raw = self._studio.list_elements(self.slide_n)
            self._elements = [ElementHandle(self._studio, self.slide_n, e) for e in raw]
        return self._elements

    def find(self, query: str, **ctx) -> "ElementHandle | None":
        result = self._studio.find_element(query, viewing_slide_n=self.slide_n, **ctx)
        cands = result.get("candidates") or []
        if not cands:
            return None
        top = cands[0]
        if top["score"] < 0.5:
            return None
        # Fetch the full element record to wrap.
        for e in self.elements:
            if e.id == top["element_id"]:
                return e
        return None

    def find_all(self, *, type: str | None = None, name_contains: str | None = None) -> list["ElementHandle"]:
        out: list[ElementHandle] = []
        for el in self.elements:
            if type and el.type != type:
                continue
            if name_contains and name_contains.lower() not in (el.name or "").lower():
                continue
            out.append(el)
        return out

    def hide(self, element_id: str) -> None:
        self._studio.patch_element(self.slide_n, element_id, {"hidden": True})

    def show(self, element_id: str) -> None:
        self._studio.patch_element(self.slide_n, element_id, {"hidden": False})

    def show_only(self, element_ids: list[str]) -> None:
        keep = set(element_ids)
        for el in self.elements:
            if el.id in keep:
                self.show(el.id)
            else:
                self.hide(el.id)


# ── ElementHandle — used inside slide scripts ──────────────────────────────


class ElementHandle:
    """Proxy for a single element on a slide. Exposes intent-level mutations.

    All setters round-trip an HTTP call. Reads are from the cached snapshot
    that was loaded with the slide.
    """

    __slots__ = ("_studio", "slide_n", "id", "type", "name", "_raw")

    def __init__(self, studio: Studio, slide_n: int, raw: dict):
        self._studio = studio
        self.slide_n = slide_n
        self.id = raw.get("id") or raw.get("element_id")
        self.type = raw.get("type")
        self.name = raw.get("name")
        self._raw = raw

    @property
    def text(self) -> str:
        return (self._raw.get("text_preview") or "") if self._raw else ""

    @property
    def position(self) -> dict:
        return {
            "left_in": self._raw.get("left_in", 0),
            "top_in": self._raw.get("top_in", 0),
            "width_in": self._raw.get("width_in", 0),
            "height_in": self._raw.get("height_in", 0),
        }

    def set_position(self, **kwargs) -> None:
        body = {k: v for k, v in kwargs.items() if k in ("left_in", "top_in", "width_in", "height_in", "rotation")}
        self._studio.patch_element(self.slide_n, self.id, body)

    def set_text(self, text: str) -> None:
        self._studio.patch_text(self.slide_n, self.id, {"text": text})

    def set_style(self, **kwargs) -> None:
        self._studio.patch_style(self.slide_n, self.id, kwargs)

    def set_fill(self, color: str) -> None:
        self.set_style(fill_color=color)

    def hide(self) -> None:
        self._studio.patch_element(self.slide_n, self.id, {"hidden": True})

    def show(self) -> None:
        self._studio.patch_element(self.slide_n, self.id, {"hidden": False})

    def lock(self) -> None:
        self._studio.patch_element(self.slide_n, self.id, {"locked": True})

    def __repr__(self) -> str:
        return f"<{self.type} {self.name!r} id={self.id}>"
