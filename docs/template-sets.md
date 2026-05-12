# Template Sets

Template Sets are how a team or organization tells Percy what its decks should
look and sound like. A set bundles five things into one package:

| Component | What it is | What the agent does with it |
|---|---|---|
| **Slide templates** | Full-slide layouts the agent can apply or generate from. | Picks from these when generating a new deck; fills in placeholders. |
| **Element templates** | Single reusable elements (KPI tile, branded callout, standard chart style). | Drops these into existing decks when the user asks for "an X-style block." |
| **Brand** | Curated palette + fonts + style rules. | Uses palette as preferred color tokens; flags off-brand colors via `/brand-check`. |
| **Instructions** | Free-form markdown voice / structural guide. | Injected verbatim into the agent's system prompt. |
| **Reference docs** | PPTX / PDF / MD examples uploaded to the set. | Mined for slide and element patterns; also drive deterministic palette/font extraction. |

## Hierarchy

```
Org
 ├── (default Template Set — applies to every project in the org)
 │
 ├── Team "Sales"            ← studio_folders row, parent_id = null
 │    ├── (optional override Template Set — replaces org default for this team)
 │    │
 │    └── Sub-team "EMEA"     ← studio_folders row, parent_id = "Sales"
 │         └── (inherits Sales override; can pin its own)
 │
 └── Project "Q3 Pitch"      ← studio_projects row, folder_id = "EMEA"
       └── (inherits nearest-ancestor set via the resolution walk)
```

**Resolution rule:** when the agent works on a project, it walks
`project.folder_id → folder.parent_id → ...` looking for the first folder with
a pinned set. If none, falls back to the org's default. If neither exists,
the agent runs without brand context (uses Percy defaults).

Projects do **not** carry their own pinned set — they always inherit. This
keeps brand consistent within a team and avoids per-deck divergence.

## Creating a set

1. **Org Settings → Templates** lists every set in the org.
2. Click **+ New template set**, give it a name (e.g. `Acme Brand v3`), and
   optionally mark it as the org default.
3. Open the set to land in the **5-tab editor**:
   - **Slides** — slide templates currently in the set
   - **Elements** — single-element templates currently in the set
   - **Brand** — palette / fonts / style rules
   - **Instructions** — markdown voice guide
   - **Refs** — reference documents uploaded for mining

## Building the set from example decks

The fastest way to populate a set is to upload existing decks as references
and let Percy mine them.

### 1. Upload references

In the **Refs** tab, drag-and-drop a PPTX/PDF onto the drop zone. Percy:

- Saves the file under `data/template_set_refs/<set_id>/`
- Runs it through the normal onboarding pipeline (same as opening a deck
  in Studio)
- Stores the resulting Bridge document ID on the ref

Each ref shows its status: `uploaded` → `onboarding` → `ready` (or `failed`).

### 2. Extract brand (optional)

The **Brand** tab has an **Extract** button. It walks every ready reference
and aggregates:

- Top 8 solid fill colors → `proposed_palette` (deterministic; no LLM)
- Top 4 font families   → `proposed_fonts`
- Chart type distribution, typography averages, table conventions

Review the proposed values and hit **Apply proposed → curated** to promote
them into the active palette/fonts. You can also edit each color/font by
hand.

### 3. Mine templates

In the **Refs** tab, click **Mine templates**. Percy:

1. Clusters slides across all references by structural fingerprint
   (element-type bag + quadrant + size band — robust to small layout jitter)
2. Clusters individual elements by style fingerprint
3. Sends each cluster's prototype to the LLM for naming + parameterization
   (the LLM proposes `inputs_schema` and judges whether the cluster is
   template-worthy vs. master-slide noise)
4. Returns review candidates sorted by confidence

For each candidate the UI shows:

- Kind (slide or element), name, description, tags
- Confidence score (derived from cluster size + LLM judgment)
- Proposed inputs
- **Add** to accept (saves as a real agent template and links it to the set)
- **Skip** to discard

Mining is **non-destructive** — until you click Add, nothing is saved.

## How the agent uses an active set

When the agent runs on a deck, it:

1. Resolves the active set via the project's folder chain
2. Injects into the planner's system prompt:
   - The `instructions_md` block verbatim
   - The palette + fonts as preferred tokens
   - Style rules (capitalization, max title length, palette tolerance)
   - A summary of every slide+element template in the set (with inputs schemas)
3. `/api/docs/{doc_id}/brand-check` reads the active set's palette/fonts to
   detect off-brand colors and fonts (instead of the Percy default).

## API reference

All endpoints below require an authenticated session cookie. Mutations are
audited via the standard middleware.

### Sets

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/orgs/{org_id}/template-sets` | List all sets in an org |
| `POST` | `/api/template-sets` | Create a new set |
| `GET`  | `/api/template-sets/{set_id}` | Get one set (with item/ref counts) |
| `PATCH`| `/api/template-sets/{set_id}` | Update name, description, instructions, palette, fonts, style_rules |
| `DELETE` | `/api/template-sets/{set_id}` | Delete (cascades to items + refs, clears any default pointers) |

### Items

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/template-sets/{set_id}/items?kind=slide|element` | List items (hydrated with the underlying agent template) |
| `POST` | `/api/template-sets/{set_id}/items` | Add an agent template to the set with `kind` + `order_index` |
| `DELETE` | `/api/template-sets/{set_id}/items/{template_id}` | Remove from the set (the agent template itself stays) |
| `POST` | `/api/template-sets/{set_id}/items/reorder` | Reorder by `template_ids` array |

### References

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/template-sets/{set_id}/refs` | Multipart upload (.pptx / .pdf / .md / .txt; ≤ 50 MB) |
| `GET`  | `/api/template-sets/{set_id}/refs` | List uploaded refs |
| `POST` | `/api/template-sets/{set_id}/refs/{ref_id}/onboard` | Run Bridge onboard pipeline |
| `DELETE` | `/api/template-sets/{set_id}/refs/{ref_id}` | Delete ref + its on-disk blob |

### Brand extraction + mining

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/template-sets/{set_id}/extract-brand-from-refs` | Deterministic palette/font aggregation |
| `POST` | `/api/template-sets/{set_id}/confirm-brand` | Promote proposed → curated |
| `POST` | `/api/template-sets/{set_id}/mine` | LLM-powered template candidate induction |
| `POST` | `/api/template-sets/{set_id}/accept-candidate` | Save a mined candidate as a real agent template |

### Defaults + resolution

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/template-sets/{set_id}/set-default` | Promote to org default (`folder_id: null`) or team override (`folder_id: <id>`) |
| `POST` | `/api/orgs/{org_id}/clear-default-template-set` | Drop the org default |
| `POST` | `/api/folders/{folder_id}/clear-template-set` | Drop a team override |
| `GET`  | `/api/projects/{project_id}/active-template-set` | Resolve the active set for a project; returns `{set, inherited_from, org_id}` |

## Data model

```
studio_templates (extended)
  id, org_id, scope, owner_id, name, description
  brand              JSON  -- auto-extracted stats (proposed_palette etc.)
  source_project_ids JSON
  last_extracted_at
  instructions_md    TEXT
  palette            JSON  -- curated palette: [{hex, name, role}]
  fonts              JSON  -- curated fonts:   [{name, role, fallbacks}]
  style_rules        JSON
  folder_id          TEXT  -- null = org-wide
  is_default         INT

studio_template_set_items
  set_id, template_id, kind, order_index, provenance, added_by, added_at

studio_template_set_refs
  id, set_id, filename, mime_type, size_bytes, storage_key, doc_id,
  slide_count, element_count, status, error, uploaded_by, uploaded_at, onboarded_at

studio_orgs:
  + default_template_set_id   -- fast-resolve pointer

studio_folders:
  + template_set_id           -- team-level override pointer
```

## Provenance

Every induced template carries a `provenance` JSON in
`studio_template_set_items` capturing:

```json
{
  "fingerprint": "(...)",
  "member_count": 7,
  "members": [{"ref_id": "ref_...", "slide_n": 3}, ...]
}
```

So the UI can show "induced from 7 samples across 2 reference decks"
indefinitely after the original mining run. Reference docs can be deleted
without invalidating already-accepted templates — provenance is a snapshot.

## Cost notes

| Operation | Compute | Approx LLM cost |
|---|---|---|
| Upload + onboard reference | Local Python (PPTX → Bridge) | 0 |
| Extract brand from refs | Deterministic aggregation | 0 |
| Mine templates (no LLM) | Local clustering only | 0 |
| Mine templates (with LLM) | 1 call per candidate (≤ 25 by default) | ~$0.04 per run on Bedrock Sonnet 4.6 |
| Agent chat with active set | +1-2 KB of system prompt context per turn | Negligible (cached) |
