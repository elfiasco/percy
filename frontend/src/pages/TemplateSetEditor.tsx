import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import {
  getTemplateSet, updateTemplateSet, deleteTemplateSet,
  listSetItems, removeSetItem,
  listRefs, uploadRef, deleteRef,
  extractBrandFromRefs, confirmBrand,
  mineTemplates, acceptCandidate,
  setAsDefault,
  getPythonModule, pythonModuleDownloadUrl,
  type TemplateSet, type TemplateSetItem, type TemplateSetRef,
  type MinedCandidate, type PaletteColor, type BrandFont, type StyleRules,
} from "../lib/templateSetsApi"
import Logo from "../components/Logo"
import ThemeToggle from "../theme/ThemeToggle"
import { useToast, useDialog } from "../components/Toaster"
import PageLoader from "../components/PageLoader"

/**
 * TemplateSetEditor — the 5-tab editor for a single Template Set.
 *
 * URL: /template-sets/:setId
 *
 * Tabs:
 *   Slides       — full-slide templates bundled in this set
 *   Elements     — single-element templates bundled in this set
 *   Brand        — curated palette + fonts + style rules
 *   Instructions — markdown voice/structure guide for the LLM
 *   Refs         — uploaded PPTX/PDF examples for mining
 */

type TabKey = "slides" | "elements" | "brand" | "instructions" | "refs" | "python"

export default function TemplateSetEditor() {
  const { setId } = useParams<{ setId: string }>()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const dialog = useDialog()

  const [set, setSet] = useState<TemplateSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>("slides")
  const [items, setItems] = useState<TemplateSetItem[]>([])
  const [refs, setRefs] = useState<TemplateSetRef[]>([])
  const [busy, setBusy] = useState(false)

  const refreshSet = useCallback(async () => {
    if (!setId) return
    try {
      const s = await getTemplateSet(setId)
      setSet(s)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [setId])

  const refreshItems = useCallback(async () => {
    if (!setId) return
    try {
      const r = await listSetItems(setId)
      setItems(r.items)
    } catch (e) {
      console.error("listSetItems failed:", e)
    }
  }, [setId])

  const refreshRefs = useCallback(async () => {
    if (!setId) return
    try {
      const r = await listRefs(setId)
      setRefs(r.refs)
    } catch (e) {
      console.error("listRefs failed:", e)
    }
  }, [setId])

  useEffect(() => { refreshSet() }, [refreshSet])
  useEffect(() => { refreshItems() }, [refreshItems])
  useEffect(() => { refreshRefs() }, [refreshRefs])

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (!setId) return <Navigate to="/home" replace />
  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-ink text-paper p-8">
        <div className="text-sm text-muted mb-2">Could not load template set</div>
        <div className="text-xs text-red-400 max-w-md text-center">{error}</div>
        <Link to="/templates" className="mt-6 text-[11px] text-muted hover:text-paper">← Back to templates</Link>
      </div>
    )
  }
  if (!set) return <PageLoader />

  const activeOrg = user.orgs.find((o) => o.id === set.org_id)

  const handleSetAsDefault = async () => {
    setBusy(true)
    try {
      await setAsDefault(set.id, null)  // null = org-wide default
      await refreshSet()
      toast.show("Set as org default", "success")
    } catch (e) {
      toast.show(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await dialog.confirm({
      title: "Delete template set?",
      message: `"${set.name}" will be removed permanently. Slide and element templates linked to it will remain in the agent library but will no longer be grouped here. Reference docs will be deleted.`,
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!confirmed) return
    try {
      await deleteTemplateSet(set.id)
      toast.show("Template set deleted", "success")
      navigate("/templates")
    } catch (e) {
      toast.show(`Delete failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const slideItems = items.filter((i) => i.kind === "slide")
  const elementItems = items.filter((i) => i.kind === "element")

  return (
    <div className="min-h-screen flex flex-col bg-ink text-paper">
      {/* top bar */}
      <div className="h-12 shrink-0 border-b border-edge bg-surface flex items-center justify-between px-5 select-none">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/templates" className="text-[10px] uppercase tracking-[0.16em] text-muted hover:text-paper">
            ← Templates
          </Link>
          <span className="text-edge">/</span>
          <Link to="/home" className="flex items-center gap-2.5">
            <Logo size={16} />
            <span className="wordmark text-[12px]">Percy</span>
          </Link>
          <span className="text-edge">/</span>
          <span className="text-[12px] text-paper truncate">{set.name}</span>
          {set.is_default && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-accent text-accent rounded">
              Default
            </span>
          )}
          {activeOrg && (
            <span className="text-[11px] text-muted ml-1">· {activeOrg.name}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!set.is_default && (
            <button
              onClick={handleSetAsDefault}
              disabled={busy}
              className="text-[10px] uppercase tracking-wider px-2 py-1 border border-edge hover:border-accent hover:text-accent transition-colors"
            >
              Set as org default
            </button>
          )}
          <button
            onClick={handleDelete}
            className="text-[10px] uppercase tracking-wider px-2 py-1 text-muted hover:text-red-400 transition-colors"
          >
            Delete
          </button>
          <ThemeToggle size="xs" />
        </div>
      </div>

      {/* tabs */}
      <div className="border-b border-edge bg-surface/40 px-5 flex items-center gap-1 text-[11px]">
        {([
          ["slides", `Slides (${slideItems.length})`],
          ["elements", `Elements (${elementItems.length})`],
          ["brand", "Brand"],
          ["instructions", "Instructions"],
          ["refs", `Refs (${refs.length})`],
          ["python", "Python"],
        ] as Array<[TabKey, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3 py-2 border-b-2 transition-colors ${
              activeTab === key
                ? "border-accent text-paper"
                : "border-transparent text-muted hover:text-paper"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* tab body */}
      <div className="flex-1 overflow-auto">
        {activeTab === "slides" && (
          <ItemsTab
            setId={set.id}
            items={slideItems}
            kindLabel="slide"
            onChange={refreshItems}
          />
        )}
        {activeTab === "elements" && (
          <ItemsTab
            setId={set.id}
            items={elementItems}
            kindLabel="element"
            onChange={refreshItems}
          />
        )}
        {activeTab === "brand" && (
          <BrandTab
            set={set}
            onChange={refreshSet}
            onExtract={async () => {
              setBusy(true)
              try {
                await extractBrandFromRefs(set.id)
                await refreshSet()
                toast.show("Brand extracted from references", "success")
              } catch (e) {
                toast.show(`Extraction failed: ${e instanceof Error ? e.message : String(e)}`, "error")
              } finally {
                setBusy(false)
              }
            }}
            onConfirm={async (palette, fonts) => {
              setBusy(true)
              try {
                await confirmBrand(set.id, { palette, fonts })
                await refreshSet()
                toast.show("Brand confirmed", "success")
              } catch (e) {
                toast.show(`Confirm failed: ${e instanceof Error ? e.message : String(e)}`, "error")
              } finally {
                setBusy(false)
              }
            }}
            busy={busy}
          />
        )}
        {activeTab === "instructions" && (
          <InstructionsTab set={set} onChange={refreshSet} />
        )}
        {activeTab === "refs" && (
          <RefsTab
            setId={set.id}
            refs={refs}
            onChange={refreshRefs}
            onMineComplete={async () => {
              await refreshItems()
            }}
            onBrandUpdated={refreshSet}
          />
        )}
        {activeTab === "python" && (
          <PythonTab setId={set.id} setName={set.name} />
        )}
      </div>
    </div>
  )
}

// ── Python tab ─────────────────────────────────────────────────────────────

function PythonTab({ setId, setName }: { setId: string; setName: string }) {
  const toast = useToast()
  const [moduleText, setModuleText] = useState<string | null>(null)
  const [polish, setPolish] = useState(false)
  const [loading, setLoading] = useState(false)
  const [itemCount, setItemCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await getPythonModule(setId, { polish })
      setModuleText(r.module_text)
      setItemCount(r.item_count)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setModuleText(null)
    } finally {
      setLoading(false)
    }
  }, [setId, polish])

  useEffect(() => { generate() }, [generate])

  const handleCopy = async () => {
    if (!moduleText) return
    try {
      await navigator.clipboard.writeText(moduleText)
      toast.show("Module copied to clipboard", "success")
    } catch (e) {
      toast.show(`Copy failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-4">
        <div className="text-[12px] text-paper font-medium mb-1">
          Auto-generated Python builder module
        </div>
        <div className="text-[11px] text-muted leading-relaxed max-w-3xl">
          A typed Python module that contains one builder function per template in
          this set. Charts use <code className="text-accent">pd.DataFrame</code> as
          the entry point. Import from your notebook or agent script, call by name,
          and a real BridgeElement gets created with this set's brand baked in.
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between border border-edge bg-surface/30 px-4 py-3 mb-4">
        <div className="flex items-center gap-4">
          <label className="text-[11px] flex items-center gap-2">
            <input
              type="checkbox"
              checked={polish}
              onChange={(e) => setPolish(e.target.checked)}
            />
            <span>AI-polished docstrings</span>
            <span className="text-muted">(one LLM call per template — slower, costs ~$0.01)</span>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            disabled={loading}
            className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-edge hover:border-accent hover:text-accent transition-colors"
          >
            {loading ? "Generating..." : "Regenerate"}
          </button>
          <button
            onClick={handleCopy}
            disabled={!moduleText}
            className="text-[10px] uppercase tracking-wider px-3 py-1.5 border border-edge hover:border-accent hover:text-accent transition-colors"
          >
            Copy
          </button>
          <a
            href={pythonModuleDownloadUrl(setId, { polish })}
            download
            className={`text-[10px] uppercase tracking-wider px-3 py-1.5 border border-accent text-accent hover:bg-accent/10 transition-colors ${
              !moduleText ? "pointer-events-none opacity-40" : ""
            }`}
          >
            Download .py
          </a>
        </div>
      </div>

      {/* Status row */}
      {!error && moduleText && (
        <div className="text-[11px] text-muted mb-2">
          {itemCount} builder function{itemCount === 1 ? "" : "s"} ·{" "}
          {moduleText.length.toLocaleString()} chars · {moduleText.split("\n").length} lines
        </div>
      )}

      {/* Code preview */}
      {error ? (
        <div className="border border-red-400/40 bg-red-400/5 text-red-400 p-4 text-[12px]">
          {error}
        </div>
      ) : !moduleText ? (
        <div className="border border-edge bg-surface/20 p-8 text-center text-[11px] text-muted">
          {loading ? "Generating module..." : "Click Regenerate to produce the module."}
        </div>
      ) : (
        <pre
          className="border border-edge bg-surface/40 p-4 overflow-auto text-[11px] font-mono text-paper leading-relaxed max-h-[60vh]"
          style={{ tabSize: 2 }}
        >
          {moduleText}
        </pre>
      )}

      {/* Usage hint */}
      <div className="mt-6 text-[11px] text-muted leading-relaxed">
        <div className="text-paper font-medium mb-1">Using the module</div>
        Save the downloaded file as <code className="text-accent">{setName.toLowerCase().replace(/\s+/g, "_")}_brand.py</code>{" "}
        next to your script, then:
        <pre className="mt-2 bg-surface/40 p-3 border border-edge text-[10px] overflow-auto">
{`from percy.studio_client import Studio
from ${setName.toLowerCase().replace(/\s+/g, "_")}_brand import title_slide, kpi_tile
import pandas as pd

studio = Studio(base_url="...", doc_id="...", auth_token="...")
n = title_slide("Q4 Review", studio=studio, subtitle="December 2025")`}
        </pre>
      </div>
    </div>
  )
}

// ── Items tab (slides or elements) ─────────────────────────────────────────

function ItemsTab({
  setId,
  items,
  kindLabel,
  onChange,
}: {
  setId: string
  items: TemplateSetItem[]
  kindLabel: "slide" | "element"
  onChange: () => Promise<void>
}) {
  const toast = useToast()
  const dialog = useDialog()

  const handleRemove = async (item: TemplateSetItem) => {
    const confirmed = await dialog.confirm({
      title: `Remove ${kindLabel} template?`,
      message: `"${item.template?.name || item.template_id}" will be removed from this set. The template itself stays in the agent library.`,
      confirmLabel: "Remove",
      tone: "danger",
    })
    if (!confirmed) return
    try {
      await removeSetItem(setId, item.template_id)
      await onChange()
      toast.show("Removed", "success")
    } catch (e) {
      toast.show(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  if (items.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="text-[12px] text-muted leading-relaxed max-w-md mx-auto">
          No {kindLabel} templates in this set yet.
          <br />
          Upload reference documents under the <strong>Refs</strong> tab and
          run <strong>Mine templates</strong> to generate candidates from
          example decks, or save current slides in Studio with “Save as
          template”.
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.map((it) => (
          <div
            key={it.template_id}
            className="border border-edge bg-surface/30 hover:border-accent transition-colors p-4 flex flex-col"
          >
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
              {it.kind}
            </div>
            <div className="text-[14px] text-paper font-medium mb-1 line-clamp-2">
              {it.template?.name || it.template_id}
            </div>
            <div className="text-[11px] text-muted mb-3 line-clamp-3 flex-1">
              {it.template?.description || ""}
            </div>
            {it.template?.tags && it.template.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {it.template.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-edge text-muted rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {it.provenance?.member_count && (
              <div className="text-[10px] text-muted mb-2">
                Induced from {String(it.provenance.member_count)} samples
              </div>
            )}
            <button
              onClick={() => handleRemove(it)}
              className="text-[10px] uppercase tracking-wider text-muted hover:text-red-400 self-start mt-auto pt-2"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Brand tab ───────────────────────────────────────────────────────────────

function BrandTab({
  set,
  onChange,
  onExtract,
  onConfirm,
  busy,
}: {
  set: TemplateSet
  onChange: () => Promise<void>
  onExtract: () => Promise<void>
  onConfirm: (palette: PaletteColor[], fonts: BrandFont[]) => Promise<void>
  busy: boolean
}) {
  const toast = useToast()
  const [palette, setPalette] = useState<PaletteColor[]>(set.palette)
  const [fonts, setFonts] = useState<BrandFont[]>(set.fonts)
  const [styleRules, setStyleRules] = useState<StyleRules>(set.style_rules)

  // Reset edits when the set is refreshed externally.
  useEffect(() => {
    setPalette(set.palette)
    setFonts(set.fonts)
    setStyleRules(set.style_rules)
  }, [set.id, set.updated_at])

  const proposed = (set.brand as Record<string, unknown>) || {}
  const proposedPalette = (proposed.proposed_palette as PaletteColor[]) || []
  const proposedFonts = (proposed.proposed_fonts as BrandFont[]) || []
  const docsScanned = (proposed.docs_scanned as number) || 0

  const dirty =
    JSON.stringify(palette) !== JSON.stringify(set.palette) ||
    JSON.stringify(fonts) !== JSON.stringify(set.fonts) ||
    JSON.stringify(styleRules) !== JSON.stringify(set.style_rules)

  const save = async () => {
    try {
      await updateTemplateSet(set.id, { palette, fonts, style_rules: styleRules })
      await onChange()
      toast.show("Brand saved", "success")
    } catch (e) {
      toast.show(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Auto-extract section */}
      <section className="border border-edge bg-surface/30 p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[12px] text-paper font-medium mb-1">
              Auto-extract from reference docs
            </div>
            <div className="text-[11px] text-muted">
              Reads palette + fonts from every onboarded reference. No LLM call —
              fast and deterministic. Last extracted: {set.last_extracted_at
                ? new Date(set.last_extracted_at * 1000).toLocaleString()
                : "never"}
            </div>
          </div>
          <button
            onClick={onExtract}
            disabled={busy}
            className="text-[11px] uppercase tracking-wider px-3 py-1.5 border border-edge hover:border-accent hover:text-accent transition-colors"
          >
            {busy ? "Extracting..." : "Extract"}
          </button>
        </div>
        {(proposedPalette.length > 0 || proposedFonts.length > 0) && (
          <div className="border-t border-edge mt-3 pt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
              Proposed ({docsScanned} docs scanned) — review and apply
            </div>
            {proposedPalette.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] text-muted mb-1">Palette</div>
                <div className="flex flex-wrap gap-2">
                  {proposedPalette.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <div className="w-5 h-5 border border-edge rounded" style={{ backgroundColor: c.hex }} />
                      <span className="text-paper">{c.hex}</span>
                      <span className="text-muted">{c.role}</span>
                      {c.count !== undefined && <span className="text-muted">×{c.count}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {proposedFonts.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] text-muted mb-1">Fonts</div>
                <div className="flex flex-wrap gap-3">
                  {proposedFonts.map((f, i) => (
                    <div key={i} className="text-[11px]">
                      <span className="text-paper">{f.name}</span>
                      <span className="text-muted"> · {f.role}</span>
                      {f.count !== undefined && <span className="text-muted"> ×{f.count}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={() => onConfirm(proposedPalette, proposedFonts)}
              disabled={busy}
              className="mt-2 text-[10px] uppercase tracking-wider px-3 py-1.5 border border-accent text-accent hover:bg-accent/10 transition-colors"
            >
              Apply proposed → curated
            </button>
          </div>
        )}
      </section>

      {/* Curated palette */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[12px] text-paper font-medium">Curated palette</div>
          <button
            onClick={() => setPalette([...palette, { hex: "#000000", name: "New", role: "accent" }])}
            className="text-[10px] uppercase tracking-wider text-muted hover:text-accent"
          >
            + Add color
          </button>
        </div>
        <div className="space-y-2">
          {palette.length === 0 && (
            <div className="text-[11px] text-muted italic">No curated palette yet.</div>
          )}
          {palette.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="color"
                value={c.hex}
                onChange={(e) => {
                  const next = [...palette]
                  next[i] = { ...c, hex: e.target.value }
                  setPalette(next)
                }}
                className="w-10 h-8 bg-transparent border border-edge cursor-pointer"
              />
              <input
                type="text"
                value={c.hex}
                onChange={(e) => {
                  const next = [...palette]
                  next[i] = { ...c, hex: e.target.value }
                  setPalette(next)
                }}
                className="w-24 bg-surface border border-edge px-2 py-1 text-[12px] font-mono"
              />
              <input
                type="text"
                placeholder="Name"
                value={c.name || ""}
                onChange={(e) => {
                  const next = [...palette]
                  next[i] = { ...c, name: e.target.value }
                  setPalette(next)
                }}
                className="flex-1 bg-surface border border-edge px-2 py-1 text-[12px]"
              />
              <select
                value={c.role || "accent"}
                onChange={(e) => {
                  const next = [...palette]
                  next[i] = { ...c, role: e.target.value }
                  setPalette(next)
                }}
                className="bg-surface border border-edge px-2 py-1 text-[12px]"
              >
                <option value="primary">primary</option>
                <option value="accent">accent</option>
                <option value="neutral">neutral</option>
                <option value="text">text</option>
                <option value="background">background</option>
              </select>
              <button
                onClick={() => setPalette(palette.filter((_, j) => j !== i))}
                className="text-muted hover:text-red-400 px-2 py-1 text-[12px]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Curated fonts */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[12px] text-paper font-medium">Curated fonts</div>
          <button
            onClick={() => setFonts([...fonts, { name: "Inter", role: "body" }])}
            className="text-[10px] uppercase tracking-wider text-muted hover:text-accent"
          >
            + Add font
          </button>
        </div>
        <div className="space-y-2">
          {fonts.length === 0 && (
            <div className="text-[11px] text-muted italic">No curated fonts yet.</div>
          )}
          {fonts.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={f.role || "body"}
                onChange={(e) => {
                  const next = [...fonts]
                  next[i] = { ...f, role: e.target.value }
                  setFonts(next)
                }}
                className="bg-surface border border-edge px-2 py-1 text-[12px]"
              >
                <option value="heading">heading</option>
                <option value="body">body</option>
                <option value="mono">mono</option>
                <option value="alt">alt</option>
              </select>
              <input
                type="text"
                placeholder="Font name"
                value={f.name}
                onChange={(e) => {
                  const next = [...fonts]
                  next[i] = { ...f, name: e.target.value }
                  setFonts(next)
                }}
                className="flex-1 bg-surface border border-edge px-2 py-1 text-[12px]"
              />
              <input
                type="text"
                placeholder="Fallbacks (comma-separated)"
                value={(f.fallbacks || []).join(", ")}
                onChange={(e) => {
                  const next = [...fonts]
                  const list = e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                  next[i] = { ...f, fallbacks: list }
                  setFonts(next)
                }}
                className="flex-1 bg-surface border border-edge px-2 py-1 text-[12px]"
              />
              <button
                onClick={() => setFonts(fonts.filter((_, j) => j !== i))}
                className="text-muted hover:text-red-400 px-2 py-1 text-[12px]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Style rules */}
      <section>
        <div className="text-[12px] text-paper font-medium mb-3">Style rules</div>
        <div className="space-y-3 text-[12px]">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(styleRules.lock_to_palette)}
              onChange={(e) => setStyleRules({ ...styleRules, lock_to_palette: e.target.checked })}
            />
            <span>Lock to palette (agent refuses to emit off-palette colors)</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted">Title capitalization:</span>
            <select
              value={(styleRules.capitalization as string) || "preserve"}
              onChange={(e) => setStyleRules({ ...styleRules, capitalization: e.target.value as StyleRules["capitalization"] })}
              className="bg-surface border border-edge px-2 py-1"
            >
              <option value="preserve">preserve</option>
              <option value="title">Title Case</option>
              <option value="sentence">Sentence case</option>
              <option value="upper">UPPERCASE</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted">Max title length:</span>
            <input
              type="number"
              value={(styleRules.max_title_length as number) || 60}
              onChange={(e) => setStyleRules({ ...styleRules, max_title_length: Number(e.target.value) })}
              className="w-20 bg-surface border border-edge px-2 py-1"
            />
            <span className="text-muted">chars</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted">Palette tolerance:</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={(styleRules.palette_tolerance as number) ?? 0.1}
              onChange={(e) => setStyleRules({ ...styleRules, palette_tolerance: Number(e.target.value) })}
              className="w-20 bg-surface border border-edge px-2 py-1"
            />
            <span className="text-muted">(0 = exact, 1 = any)</span>
          </div>
        </div>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-surface/95 border-t border-edge flex items-center justify-between">
        <div className="text-[11px] text-muted">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </div>
        <button
          onClick={save}
          disabled={!dirty || busy}
          className={`text-[11px] uppercase tracking-wider px-4 py-2 transition-colors ${
            dirty
              ? "bg-accent text-ink hover:bg-accent/80"
              : "border border-edge text-muted cursor-not-allowed"
          }`}
        >
          Save brand
        </button>
      </div>
    </div>
  )
}

// ── Instructions tab ────────────────────────────────────────────────────────

function InstructionsTab({
  set,
  onChange,
}: {
  set: TemplateSet
  onChange: () => Promise<void>
}) {
  const toast = useToast()
  const [md, setMd] = useState(set.instructions_md)
  useEffect(() => { setMd(set.instructions_md) }, [set.id, set.updated_at])
  const dirty = md !== set.instructions_md

  const save = async () => {
    try {
      await updateTemplateSet(set.id, { instructions_md: md })
      await onChange()
      toast.show("Instructions saved", "success")
    } catch (e) {
      toast.show(`Save failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-3">
        <div className="text-[12px] text-paper font-medium mb-1">Instructions to the AI</div>
        <div className="text-[11px] text-muted">
          Markdown. Sent verbatim to the LLM whenever this set is the active set
          for a deck. Use it for voice rules, structural conventions, "always do X / never do Y" guidance.
        </div>
      </div>
      <textarea
        value={md}
        onChange={(e) => setMd(e.target.value)}
        rows={20}
        placeholder={`# Acme Brand voice\n\n* Lead with the metric.\n* Always cite source and date.\n* Use sentence case in body, Title Case in headings.\n* Prefer charts over tables when ≤ 6 series.\n`}
        className="w-full bg-surface border border-edge p-3 text-[13px] font-mono text-paper focus:border-accent outline-none"
        spellCheck={false}
      />
      <div className="flex items-center justify-between mt-3">
        <div className="text-[11px] text-muted">
          {dirty ? "Unsaved changes" : "All changes saved"} · {md.length.toLocaleString()} chars
        </div>
        <button
          onClick={save}
          disabled={!dirty}
          className={`text-[11px] uppercase tracking-wider px-4 py-2 transition-colors ${
            dirty ? "bg-accent text-ink hover:bg-accent/80" : "border border-edge text-muted cursor-not-allowed"
          }`}
        >
          Save instructions
        </button>
      </div>
    </div>
  )
}

// ── Refs tab ────────────────────────────────────────────────────────────────

function RefsTab({
  setId,
  refs,
  onChange,
  onMineComplete,
  onBrandUpdated,
}: {
  setId: string
  refs: TemplateSetRef[]
  onChange: () => Promise<void>
  onMineComplete: () => Promise<void>
  onBrandUpdated: () => Promise<void>
}) {
  const toast = useToast()
  const dialog = useDialog()
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [mining, setMining] = useState(false)
  const [candidates, setCandidates] = useState<MinedCandidate[]>([])
  const [llmUsed, setLlmUsed] = useState(false)

  // Poll while any refs are mid-onboard. Backend's BackgroundTask updates
  // status to 'ready' or 'failed' when done; we just need to refresh the
  // list every couple of seconds until nothing's pending. Also refresh the
  // parent set so the Brand tab's proposed_palette / proposed_fonts pick up
  // the auto-extract that fires after each onboard completes.
  useEffect(() => {
    const pending = refs.filter((r) => r.status === "onboarding" || r.status === "uploaded")
    if (pending.length === 0) return
    const handle = window.setInterval(async () => {
      await onChange()
      await onBrandUpdated()
    }, 2500)
    return () => window.clearInterval(handle)
  }, [refs, onChange, onBrandUpdated])

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        await uploadRef(setId, file)
        // Backend now auto-schedules onboarding via BackgroundTasks; no
        // explicit /onboard call needed. Polling above catches readiness.
      }
      await onChange()
      toast.show(
        `Uploaded ${files.length} file${files.length === 1 ? "" : "s"} — onboarding in background`,
        "success",
      )
    } catch (e) {
      toast.show(`Upload failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const handleDelete = async (ref: TemplateSetRef) => {
    const confirmed = await dialog.confirm({
      title: "Delete reference?",
      message: `"${ref.filename}" will be removed from this set. Already-mined templates stay.`,
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!confirmed) return
    try {
      await deleteRef(setId, ref.id)
      await onChange()
      toast.show("Reference deleted", "success")
    } catch (e) {
      toast.show(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const handleMine = async () => {
    setMining(true)
    setCandidates([])
    try {
      const r = await mineTemplates(setId, { use_llm: true })
      setCandidates(r.candidates)
      setLlmUsed(r.llm_used)
      toast.show(`Found ${r.candidates.length} template candidates`, "success")
    } catch (e) {
      toast.show(`Mining failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    } finally {
      setMining(false)
    }
  }

  const handleAccept = async (cand: MinedCandidate, idx: number) => {
    try {
      await acceptCandidate(setId, cand)
      setCandidates(candidates.filter((_, i) => i !== idx))
      await onMineComplete()
      toast.show(`Added "${cand.name}" to set`, "success")
    } catch (e) {
      toast.show(`Accept failed: ${e instanceof Error ? e.message : String(e)}`, "error")
    }
  }

  const handleReject = (idx: number) => {
    setCandidates(candidates.filter((_, i) => i !== idx))
  }

  const readyCount = refs.filter((r) => r.status === "ready").length

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Upload */}
      <div
        onDragOver={(e) => { e.preventDefault() }}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
        className="border-2 border-dashed border-edge p-8 mb-6 text-center cursor-pointer hover:border-accent transition-colors"
        onClick={() => fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".pptx,.pdf,.md,.txt"
          multiple
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files)}
        />
        <div className="text-[12px] text-paper mb-1">
          {uploading ? "Uploading..." : "Drop PPTX / PDF / MD here, or click to choose"}
        </div>
        <div className="text-[11px] text-muted">
          Used to mine template patterns and extract brand. Max 50 MB per file.
        </div>
      </div>

      {/* Mine action */}
      {readyCount > 0 && (
        <div className="flex items-center justify-between border border-edge bg-surface/30 p-4 mb-6">
          <div>
            <div className="text-[12px] text-paper">Mine templates from {readyCount} reference{readyCount === 1 ? "" : "s"}</div>
            <div className="text-[11px] text-muted mt-0.5">
              Clusters repeating slides and elements, asks the AI to name and parameterize them.
            </div>
          </div>
          <button
            onClick={handleMine}
            disabled={mining}
            className="text-[11px] uppercase tracking-wider px-4 py-2 border border-accent text-accent hover:bg-accent/10 transition-colors"
          >
            {mining ? "Mining..." : "Mine templates"}
          </button>
        </div>
      )}

      {/* Candidates */}
      {candidates.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[12px] text-paper font-medium">
              {candidates.length} candidate{candidates.length === 1 ? "" : "s"} for review
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted">
              {llmUsed ? "AI-named" : "Deterministic only"}
            </div>
          </div>
          <div className="space-y-3">
            {candidates.map((c, idx) => (
              <div key={idx} className="border border-edge bg-surface/30 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase tracking-wider text-muted">{c.kind}</span>
                      <span className="text-[14px] text-paper">{c.name}</span>
                      <span className="text-[10px] text-muted">
                        confidence {(c.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-[11px] text-muted mb-2">{c.description}</div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(c.tags || []).slice(0, 6).map((t) => (
                        <span key={t} className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-edge text-muted">
                          {t}
                        </span>
                      ))}
                    </div>
                    {Object.keys(c.inputs_schema || {}).length > 0 && (
                      <div className="text-[10px] text-muted">
                        Inputs: {Object.keys(c.inputs_schema).join(", ")}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 ml-3 shrink-0">
                    <button
                      onClick={() => handleAccept(c, idx)}
                      className="text-[10px] uppercase tracking-wider px-2 py-1 border border-accent text-accent hover:bg-accent/10"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => handleReject(idx)}
                      className="text-[10px] uppercase tracking-wider px-2 py-1 text-muted hover:text-red-400"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Refs list */}
      <div className="space-y-2">
        {refs.length === 0 && (
          <div className="text-[11px] text-muted italic">No references uploaded yet.</div>
        )}
        {refs.map((ref) => (
          <div key={ref.id} className="flex items-center justify-between border border-edge bg-surface/20 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-paper truncate">{ref.filename}</div>
              <div className="text-[10px] text-muted mt-0.5">
                {(ref.size_bytes / 1024).toFixed(0)} KB
                {ref.status === "ready" && ref.slide_count > 0 && (
                  <> · {ref.slide_count} slides · {ref.element_count} elements</>
                )}
                {ref.status === "failed" && ref.error && (
                  <span className="text-red-400"> · {ref.error}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 border ${
                ref.status === "ready" ? "border-accent text-accent"
                : ref.status === "failed" ? "border-red-400 text-red-400"
                : "border-edge text-muted"
              }`}>
                {ref.status}
              </span>
              <button
                onClick={() => handleDelete(ref)}
                className="text-muted hover:text-red-400 text-[14px]"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
