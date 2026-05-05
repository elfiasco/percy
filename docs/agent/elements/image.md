# BridgeImage — Capability Spec

**Class:** `src/percy/bridge/elements.py::BridgeImage`
**Today's create endpoint:** `POST /api/docs/{doc_id}/slides/{n}/elements/image` (exists; needs unified surface)

## What it is

A raster or vector image on a slide. Stores raw bytes + dimensions + cropping + optional border/shadow + optional shape geometry mask (for non-rectangular image fills).

## Anatomy

```
BridgeImage
├── position, transforms, stacking, identification, accessibility (base)
├── image_data           ImageData(image_bytes, image_base64, image_format)
├── file_info            ImageFileInfo(original_filename, original_path)
├── dimensions           ImageDimensions(width_px, height_px, dpi)
├── cropping             ImageCropping(crop_left/right/top/bottom — fractions 0-1)
├── border               ImageBorder(has_border, border_color, border_width)
├── shadow               ShapeShadow
├── hyperlink            string
├── fill_mode            "stretch" | "tile" | "fit" | None
├── shape_geometry       prstGeom preset (e.g. "roundRect"); None == rect
└── shape_geometry_adj   dict — geometry adjustments
```

## Required for creation

Pick one source:

| Source | Field | Notes |
|---|---|---|
| Raw bytes | `image_bytes` (base64) + `image_format` | client-side encoded |
| File upload | multipart form with `file` | recommended — same as existing endpoint |
| URL | `image_url` | server fetches with allowlist + size cap |
| Generated | `prompt` (Phase 1.5) | DALL-E / Imagen / local SD; gated behind a flag |
| Project asset | `asset_id` | references uploaded asset (Phase 3) |

Plus:

| Field | Type | Notes |
|---|---|---|
| `position` | `{left_in, top_in, width_in, height_in}` | if width/height omitted, derived from image natural size at 96 DPI |

## Optional for creation

| Field | Default | Notes |
|---|---|---|
| `crop` | `{left:0, right:0, top:0, bottom:0}` | fractions of image dimensions |
| `border_color` | None | |
| `border_width` | 0 | points |
| `shadow` | None | same shape as BridgeShape |
| `shape_geometry` | None (rect) | `"roundRect"`, `"ellipse"`, etc. — clips image to shape |
| `fill_mode` | `"stretch"` | |
| `alt_text` | None | accessibility |
| `hyperlink` | None | |
| `name` | derived from filename | |

## Edit-only

- `dpi` (read from source)
- `original_filename`, `original_path` (provenance)
- `image_base64` vs `image_bytes` choice (server picks based on storage backend)

## Gotchas

- **Storage size.** Raster images can be MB-scale; reject uploads > 10MB on the API by default and require the user to opt in for larger.
- **URL fetch security.** If accepting `image_url`, allowlist the protocols (https only), enforce size cap, set timeout, validate Content-Type starts with `image/`.
- **Generated images need attribution.** When `prompt` is used, store the prompt + provider in `custom_properties.generation` for audit.
- **Cropping is fractional, not pixel.** `crop_left=0.1` means crop 10% off the left.
- **`shape_geometry` clips, doesn't reshape.** Setting it to `"roundRect"` rounds the corners; the image still fills the bounding box.

## Example payloads

```json
// Multipart upload (same as existing endpoint, formalized)
POST /api/docs/{doc_id}/slides/3/elements/image
Content-Type: multipart/form-data
file: <binary>
metadata: {"position": {"left_in": 1, "top_in": 1, "width_in": 4, "height_in": 3},
           "shape_geometry": "roundRect", "alt_text": "Q4 revenue chart screenshot"}
```

```json
// URL
POST /api/docs/{doc_id}/slides/3/elements/image
{
  "image_url": "https://example.com/logo.png",
  "position": {"left_in": 0.5, "top_in": 0.3, "width_in": 1.2, "height_in": 0.6},
  "alt_text": "Company logo"
}
```

```json
// Phase 1.5 — generated
POST /api/docs/{doc_id}/slides/3/elements/image
{
  "prompt": "minimalist line illustration of a growing tree, monochrome",
  "position": {"left_in": 5, "top_in": 2, "width_in": 4, "height_in": 4},
  "provider": "openai/dall-e-3"
}
```
