# Percy Architecture Notes

## User Decisions

- Rebuild starts from blank slides only. Percy should not depend on original slide layouts, masters, or templates when creating output decks.
- Onboarding must synthesize inherited PowerPoint formatting into each Bridge element. Bridge objects should not say "default" when the effective value came from a layout, master, or theme.
- Group shapes should not be preserved as opaque containers during onboarding. Each child object should become its own Bridge element, with group lineage stored as metadata.
- Footer/date/page-number placeholders should be treated as normal slide elements for rebuild purposes, while presentation-level metadata should also keep an index of them.
- PDF files in the dump are visual reconstruction targets. They are not semantically parseable like PPTX, but they belong in the training loop as rendered page targets.

## Current XML Learnings From Dumped PPTX Files

- Placeholder inheritance is layered: slide shape XML can omit font attributes entirely, layout placeholder XML can provide geometry/text defaults, slide master `p:txStyles` often supplies level-based text styles, and the theme resolves `+mj-lt`, `+mn-lt`, and scheme colors like `tx1`.
- Title placeholders commonly resolve font name/size from `p:sldMaster/p:txStyles/p:titleStyle/a:lvl1pPr/a:defRPr`.
- Body/content placeholders use `bodyStyle` or `otherStyle` depending on placeholder type. Many enterprise decks use placeholder names inconsistently, so placeholder `type` and `idx` are more reliable than shape name.
- Some master text levels omit character properties such as font size. In the Salesforce dump, `bodyStyle/lvl2pPr/a:defRPr` omitted `sz` while `bodyStyle/lvl1pPr/a:defRPr` had `sz="2000"`. Percy currently falls back to level 1 in the same style family for missing inherited character values.
- Group-heavy decks, especially the Snowflake template, store large visual systems as `GROUP` shapes containing text boxes, pictures, freeforms, and preset geometry. Percy should flatten these into individual elements with `group_id`/`group_path`.
- Slide numbers and footer elements often appear as placeholders, but for Percy they should be onboarded as normal text elements and separately indexed in `PresentationMetadata`.
- Freeforms and custom geometry appear frequently enough in real decks that exact XML preservation or image fallback will matter before semantic freeform reconstruction is complete.
- Auto-shapes with text are still shapes, not textboxes. Onboarding now keeps preset geometry, fill, line, text frame insets, and resolved nested text together in `BridgeShape`. Only true `TEXT_BOX` and `PLACEHOLDER` shapes become `BridgeText`.
- Current audit-onboarding counts after that split: Snowflake has 858 `BridgeShape`, 291 `BridgeText`, 1450 `BridgeFreeform`, 168 `BridgeConnector`; Visa has 111 `BridgeShape`, 156 `BridgeText`, 17 `BridgeFreeform`, 43 `BridgeConnector`. This is a better reflection of the underlying PPTX object model than classifying every shape with a text frame as text.
- Preset geometry should be stored as the canonical DrawingML preset key such as `roundRect`, not an enum display string such as `ROUNDED_RECTANGLE (5)`. Rebuild can map that Python string back through python-pptx's auto-shape registry.
- Freeform geometry can be represented as structured Python path commands instead of XML blobs. Percy now captures `moveTo`, `lnTo`, `quadBezTo`, `cubicBezTo`, `arcTo`, and `close` as `PathCommand` values under `FreeformPath`, plus path dimensions, fill mode, stroke flag, line cap/join, and EMU transform.
- The current dumped PPTX corpus contains 22 charts: 12 clustered columns, 4 doughnuts, 2 pies, 2 lines, 1 clustered bar, and 1 stacked area. All chart examples have an external-data relationship; many also include embedded workbooks. Percy should treat cached chart data as the semantic source for roundtrip unless/until it explicitly re-links or preserves workbook sources.
- Chart onboarding now resolves into Python fields for title text, categories, series values, plot type, data-label presence, point formatting, category/value axes, tick labels, gridlines, legend settings, chart-space fill/style, and chart semantic debt. The one combo chart in the current dump is a column-plus-line chart and should eventually become a multi-plot Bridge model rather than a single `chart_type`.
- Chart `externalData` does not always mean "external file". It is a chart XML pointer from `c:chartSpace/c:externalData/@r:id` to `ppt/charts/_rels/chartN.xml.rels`. In the current dump it resolves to either an internal `officeDocument/relationships/package` target such as `../embeddings/Microsoft_Excel_Worksheet.xlsx`, or a true external `officeDocument/relationships/oleObject` target with `TargetMode="External"` and a `file:///\\...xlsx` corporate-share path.
- The dumped chart `externalData/c:autoUpdate` values observed so far are all false (`0`). That means the cached chart series/categories inside chart XML are the stable data Percy can use when an external workbook path is unavailable.
- Embedded chart workbooks are normal XLSX zip packages. Percy now extracts them into structured Python workbook sheets and cells (`ChartWorkbookSheet`/`ChartWorkbookCell`) with address, row, column, value, formula, type, and style id. We still keep the original workbook bytes for debugging or future exact workbook preservation, but Bridge roundtrip should prefer the structured snapshot plus chart cache, not raw worksheet XML.
- Current chart-data-source audit: 14 charts use embedded workbook package relationships and 8 use true external OLE links. Embedded workbook extraction captured 7,731 worksheet cells; the largest examples are Visa slide 12 charts whose embedded workbooks include 17 sheets and about 1,760 populated cells each.
- Native PowerPoint tables are DrawingML table grids, not Excel tables. The useful semantic surface is rows, columns, grid dimensions, table style flags, table style id, per-cell text frame/runs, margins, fill, borders, and merge/span state. Conditional-looking formatting generally comes from table style options such as first row, first column, banded rows, and banded columns; true Excel conditional formatting only appears when the table is actually an embedded workbook/OLE object rather than a native PowerPoint table.
- Current native-table audit across the dumped PPTX corpus found 4 tables and 128 cells. None have merged cells. All 4 use table style ids, and 3 use diagonal borders. Percy now captures table cells as structured Python `CellFormat` objects with paragraphs/runs, margins, fills, borders, grid coordinates, and merge metadata.

## Current Training Priorities

- Reduce unresolved inherited text properties in the current dump.
- Improve group child coordinate handling. Group children may use coordinates relative to the group transform; Percy currently records what python-pptx exposes and needs validation against rendered output.
- Preserve freeform/custom geometry more faithfully.
- Rebuild `BridgeShape` using its geometry preset, fill, line, and nested text runs rather than generic rectangles.
- Extend freeform rebuild beyond line-only paths to support cubic/quad Beziers and arcs. Current python-pptx only exposes a public builder for move/line/close paths, so complex paths still rebuild as placeholders unless we add a pythonic extension to that builder.
- Replace outdated inspection warnings that still say auto-shapes/connectors "may rebuild as generic rectangles"; those warnings predate the current structured rebuild.
- Improve chart formatting rebuild: charts are now rebuilt as real PowerPoint chart objects from cached categories/series, but detailed styling still needs mapping for data labels, per-point colors, axis/gridline lines, plot area fill, legend font/fill/border, and combo chart secondary axes.
- Use the workbook snapshot to reconcile chart formulas against cached series. For embedded workbooks, formulas should point into cells Percy can inspect; for external OLE links, Percy should preserve the external target/formulas as provenance while rebuilding from the cache unless the external workbook is available.
- Improve table rebuild by mapping diagonal borders and table style ids through pythonic table APIs or package-level helpers. Current rebuild preserves native table grid, text runs, dimensions, style flags, fills, margins, and merge state, but table style expansion and diagonal border recreation remain tracked semantic debt.
- Add PDF page rendering so PDF-only enterprise decks can serve as visual targets.
