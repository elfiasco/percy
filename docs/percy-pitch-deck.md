# Percy Pitch Deck

_Blueprint for the main Percy deck. Narrative thread: business storytelling has never had an operating system. Percy is it._

---

## Narrative Arc

**Act 1 — The Historical Gap:** A great leap happened in 1987. Nothing meaningful has happened since.
**Act 2 — The Cost of the Gap:** The manual labor of bridging data and narrative is enormous and invisible.
**Act 3 — The Mission:** Percy is the missing operating layer between data, AI, and business storytelling.
**Act 4 — The Technology:** The Bridge model makes every visual element structured, inspectable, and programmable.
**Act 5 — The Product:** Percy Studio — a canvas where every element is also a program.
**Act 6 — The Platform:** Enterprise organizational intelligence. Every document, pipeline, and binding accumulates into a structured corpus of the organization's business communication — queryable, AI-operable, and compounding over time. The operating system for how an enterprise understands and describes itself.

---

## Slides

---

### Slide 1 — The Hook

**Visual:** Full bleed white. One thing on the page.

> **1987**

Beneath it, small and quiet:

> _PowerPoint replaced flipping through physical slides._

**Design intent:** Nothing else. Let the year sit. The audience should feel the gap before you explain it.

---

### Slide 2 — The Empty Timeline

**Visual:** Two horizontal timelines stacked. Same x-axis (1970 → 2026). Row 1 is dense with dots. Row 2 has one dot, then nothing.

**Row 1 — "How we understand data":**
Dense and active. Milestones include:
- 1974 — SQL
- 1979 — VisiCalc (first spreadsheet)
- 1985 — Excel
- 1991 — The web
- 1996 — Data warehousing
- 2003 — Tableau _(interactive dashboards)_
- 2008 — Python / pandas
- 2010 — Amazon Redshift
- 2012 — Snowflake founded
- 2014 — Jupyter Notebooks · Power BI
- 2016 — dbt
- 2018 — Databricks
- 2020 — Modern data stack matures
- 2022 — Large language models
- 2024 — AI agents

**Row 2 — "How we communicate it":**
One entry. Then silence.
- 1987 — PowerPoint
- _(long empty line to today)_

**No headline. No copy.** The visual makes the argument.

**Design note on Tableau and Power BI:** Both belong on the data row, not the presentation row. Tableau embeds dashboards inside PowerPoint slides. Power BI exports visuals into PowerPoint. These tools solve "how do we understand data" — they hand off to the 1987 format for delivery. Their presence on the data row makes the presentation row's silence louder.

**Design intent:** The emptiness in row 2 IS the slide. The audience reads it before you say a word. If you want one line of copy: _"The gap is where your analysts live."_

---

### Slide 3 — Business Storytelling Has No Operating System

**Headline:**
> Business storytelling is the last form of knowledge work without an operating system.

**Body:**
Code has version control. Data has pipelines. Design has Figma. Infrastructure has Terraform.

But business storytelling — the decks, the QBRs, the board reports, the executive narratives that move organizations — is still assembled by hand, in PowerPoint, disconnected from the data, code, and templates that created it.

**Design intent:** This is the philosophical center of the deck. Lean into "business storytelling" as a distinct category of work — not "slide-making," not "reporting" — storytelling. It deserves its own infrastructure.

---

### Slide 4 — The Loop That Never Ends

**Headline:**
> Every recurring report is rebuilt from scratch. Every time.

**Visual:** A circular diagram — the loop:

1. Pull data from warehouse / spreadsheet / dashboard
2. Paste numbers into PowerPoint
3. Reformat, resize, realign
4. Send for review
5. Data changes. Go to step 1.

**Arrow on the loop labeled:** _"every week, by hand"_

**Beneath the loop, three quiet lines:**
- Numbers go stale the moment they are pasted
- No version history. No audit trail. No connection to source.
- Senior analysts spend their time on formatting, not insight.

**Design intent:** Make the audience feel the grind. This loop is familiar to every data team, finance team, strategy team, and ops team in the room.

---

### Slide 5 — The Talent Problem

**Headline:**
> Your most expensive people spend Friday afternoon on slide formatting.

**Visual:** Simple. One axis: skill level. One bar chart comparing time spent on:
- Insight and analysis
- Formatting, copying, pasting, rebuilding

**Subtext:** _This is not a workflow problem. It is an infrastructure problem. There is no PowerPoint equivalent of a data pipeline._

---

### Slide 6 — The Mission

**Full bleed. Large type. Centered.**

> Percy is the missing operating layer  
> between data, AI, and business storytelling.

**Design intent:** Nothing else on this slide. This is the pivot from problem to solution. Let it breathe.

---

### Slide 7 — The Core Insight

**Headline:**
> The deck is not the source of truth. It should be a rendered result.

**Visual:** Before / After.

**Before (left):** The deck is the artifact. Everything flows in manually — from spreadsheets, databases, dashboards, email threads. The deck sits at the top of the stack. It is the destination and the source simultaneously. When data changes, someone rebuilds it by hand.

**After (right):** The deck is an output. Underneath it: data, code, templates, human-reviewed narrative — all connected through Percy. When data changes, Percy rerenders. The deck is always current. The organization's visual communication system is now computational.

---

### Slide 8 — The Bridge

**Headline:**
> Every visual element becomes structured, inspectable, and programmable.

**Visual:** Three-panel diagram.

**Panel 1 — Onboard:** Drop in your existing PowerPoint decks, PDFs, Tableau workbooks, brand templates. Percy reads them. Every chart, table, text box, shape, layout, and style becomes a Bridge element with a name, structure, and history.

**Panel 2 — The Bridge Element:** Zoomed view of one element — a chart, say — showing its properties:
- Data binding (SQL query / Python / API)
- Formatting rules
- Refresh logic
- Provenance (where it came from)
- Validation rules
- AI-readable semantic description

**Panel 3 — Output:** The element, rendered. Current. Correct. Ready to export to PowerPoint, PDF, or web.

**Subtext:** _Bridge elements are not locked in Percy. They are structured records that connect to the systems that produce truth._

---

### Slide 9 — Onboard. Bind. Refresh.

**Headline:**
> Three steps from static file to living system.

**Three large numbered steps:**

**1 — Onboard**
Drop in your existing decks, templates, and reporting artifacts. Percy extracts reusable Bridge elements and learns your organization's visual language — layouts, chart styles, table styles, brand rules, recurring data narratives. You do not start from scratch. You start from what already exists.

**2 — Bind**
Attach each element to the data and code that drives it. Python snippets, SQL queries, spreadsheet connections, API calls, warehouse integrations. The element now has a source of truth.

**3 — Refresh**
Run a job. Percy rebuilds the deck from current data, compares it against the previous version, flags regressions for human review, and exports to the channels your organization already uses. The deck is always one command away from current.

---

### Slide 10 — Percy Studio

**Headline:**
> A canvas where every element is also a program.

**Visual:** Percy Studio mockup / screenshot.

Left panel — Bridge element inspector:
- Element name and type
- Data binding (live Python snippet)
- Last refreshed timestamp
- Diff status vs. prior version
- Run / Preview button

Right panel — Slide canvas:
- The actual slide, rendered
- Elements selectable, draggable, resizable
- Every element shows its binding status

**Copy:**
Edit visually. Attach logic. Run and compare. Collaborate with your team. Ship the deck.

Studio exists as a web app for collaborative enterprise workflows and a desktop app for local, private, offline-friendly work.

**Design intent:** This is the product slide. It should feel like the tool that makes the mission real — not a prototype, a system.

---

### Slide 11 — AI That Operates on Structure

**Headline:**
> AI that works with structured business visuals — not screenshots.

**The difference:**

Most AI tools for presentations operate on top of PowerPoint as-is — they see a rendered image or raw Office XML. They guess at what the slide means.

Percy gives AI structured Bridge elements to work with. AI in Percy can:
- Generate a new deck from a prompt, your data, and your company's approved examples
- Update a recurring report with current numbers
- Summarize what changed from the prior version
- Identify stale or inconsistent metrics
- Suggest visual improvements against your brand rules
- Convert a dashboard into an executive narrative
- Explain what a slide is doing and what data drives it

**Subtext:** _AI that can read and write structured business visuals is qualitatively different from AI that reads slides. Percy makes that possible._

---

### Slide 12 — Who It's For

**Headline:**
> Built for the people who produce truth and have to package it too.

**Four tiles:**

**Data & Analytics**
Builds the numbers. Then rebuilds the slides. Percy closes the loop — the analysis feeds the deck directly.

**Finance**
Weekly and monthly decks, always one database refresh away from being wrong. Percy makes the refresh automatic and auditable.

**Strategy**
Board decks and investor materials assembled by hand from twelve sources. Percy gives every element a source of truth and a version history.

**Operations**
Recurring reports nobody can reproduce because the person who built them left. Percy makes every report a documented, reproducible system.

---

### Slide 13 — Enterprise-Grade From the Start

**Headline:**
> Built for organizations that cannot afford to get this wrong.

**Grid of platform capabilities:**

| Capability | What It Means |
|---|---|
| Bridge model | Every visual element is structured, versioned, auditable — the foundation of everything |
| Organizational element corpus | Uploaded documents decompose into shared team memory: chart types, layouts, data refs, brand tokens |
| Shared data pipelines | One pipeline feeds every deck that uses that metric — definitions enforced by architecture |
| Python execution | Sandboxed, permissioned, run-history tracked — data work lives inside the presentation layer |
| Agentic AI on structured elements | AI that reasons about data provenance, staleness, and consistency — not just text |
| Multiplayer collaboration | Live presence, comments, element-level ownership, approvals |
| Template & component library | Reusable layouts, chart styles, brand rules — org knowledge made permanent |
| Visual QA & diffing | Before/after comparison on every refresh, automated regression detection |
| Interactive live outputs | Web presentations where elements stay alive: live charts, filterable tables, scenario toggles |
| Audit trails | Every action logged — who changed what, when, from what source, and who approved it |
| Role-based access | Teams, sub-teams, project-level permissions, access request flows |
| Secure AI | Operates on structured elements; sandboxed; no raw document exposure to LLMs |
| Export fidelity | PowerPoint, PDF, web — the format is a choice, not a constraint |

---

### Slide 14 — The Vision

**Headline (full bleed, large):**

> The final boss for data visualization and reporting.

**Beneath it:**

Not just decks.
Not just dashboards.
Not just templates.
Not just AI generation.

> One platform where your organization encodes how it understands and describes itself — and that knowledge compounds.

**Subtext:**
_PowerPoint is an output format. Percy is the system underneath — the structured model of your organization's business communication, alive and queryable._

---

### Slide 15 — The Organization That Knows Itself

**Headline:**
> A mature Percy deployment is organizational intelligence infrastructure.

**The compound flywheel:**

Most enterprise software gets more useful as you add users. Percy gets more useful as you add **knowledge** — and knowledge, unlike seats, compounds.

Every document uploaded, every data pipeline built, every chart bound to a source, every refresh approved and audited — all of it accumulates into a structured corpus. Not a file archive. A queryable, AI-operable model of your organization's business communication.

**What becomes possible at scale:**

- _"What was our stated net revenue retention in every investor update since Series B?"_ — answered instantly, with source citations
- _"Which slides across which decks use a different definition of ARR than our current one?"_ — surfaced automatically, flagged for remediation
- _"Alert me when any metric in the live board deck moves more than 10% week-over-week."_ — a standing monitor, not a manual check
- _"Generate a draft Q3 board update in our format, using our live data, highlighting what changed from Q2."_ — done in seconds after six months of institutional learning
- _"Who approved the revenue figure in last quarter's earnings presentation, and what was the source?"_ — fully auditable, unambiguous

**What stops walking out the door:**

In most organizations, the knowledge of how to build the board deck lives in one analyst's head. When they leave, it leaves. Percy encodes that knowledge structurally: the data bindings, the Python transforms, the chart conventions, the layout patterns, the approved metric definitions. New team members inherit the organization's reporting intelligence on day one. Senior institutional knowledge stops being fragile.

**What alignment looks like when it's structural:**

When every team's presentations draw from the same shared pipelines, "which version of ARR is this?" stops being a question. The sales deck, the board deck, the investor update, and the QBR all draw from the same source. Consistency is not a process — it is enforced by the architecture.

**The destination:** An organization where business storytelling is institutional, not individual. Where the best analyst's work becomes a permanent organizational asset. Where the gap between "data changed" and "decision-makers know" shrinks from days to minutes.

---

### Slide 16 — The Market Is Already Being Validated

**Headline:**
> The category is real. The right solution does not exist yet.

**Copy:**
Every major technology platform — Microsoft, Google, Anthropic, Notion, Figma — is rushing to add AI to presentations. None of them are solving the right problem.

**The incumbents are adding AI assistants to the old way of working. Percy replaces the architecture.**

| Company | Signal | What They Actually Do |
|---|---|---|
| **Microsoft Copilot** (PowerPoint) | Hundreds of millions of seats | AI rewrites text, reformats slides, generates images. Cannot bind data. Cannot refresh on a schedule. No Python. No QA. (GA: April 2026) |
| **Claude for PowerPoint** (Anthropic) | Backed by $4B+ in funding | Add-in generates slides from prompts using master styles. Still in beta. No data binding, no refresh, no PPTX onboarding as a structured model. |
| **Google Slides + Gemini** | 3B+ Workspace users | AI generates images and individual slides. No live data connections. Multi-slide generation not yet available. |
| **Notion** | $10B valuation | Presentation Mode turns Notion pages into slides. Cannot export .pptx. No external data binding. Locked to Notion ecosystem. |
| **Figma Slides** | $12.5B valuation | Design-first slides with AI layout suggestions. No data connections, no scheduling, no business reporting automation. |
| Gamma | $68M Series B — **$2.1B valuation** (Nov 2025) | AI generates slides from prompts. No data binding. No artifact onboarding. No .pptx export. $100M+ ARR. |
| Rollstack | $11M Series A (YC + Insight) | Embeds BI screenshots (Tableau, Power BI, Looker) into slides on a schedule. Cannot onboard existing decks. No Python. No QA. |
| Prezent.ai | $30M Series C — **$400M valuation** | Brand compliance for enterprise decks. No live data connections. "Overnight" delivery uses human staff. |
| Hex | $70M Series C — **$420M valuation** | Data notebooks with Python and shareable apps. No slide output, no presentation workflow. |

**The signal:** Microsoft shipping Copilot into PowerPoint (GA April 2026) and Anthropic launching Claude for PowerPoint (beta 2026) confirm that AI in presentations is no longer a question — it is the direction of travel. Gamma's $100M+ ARR proves enterprises will pay. Rollstack's YC backing proves investors believe in data-connected slides.

**The gap:** Every solution treats the presentation as a destination where AI helps you write and design. Percy treats the presentation as a compiled output — a rendered result of a structured data program. Not one competitor can take a company's existing board deck and make it live, data-connected, auditable, and automatically refreshable. That is Percy.

**One data point worth noting:** Tome raised $43M, hit 20M users, and then completely shut down its presentation product in April 2025, pivoting to CRM (Lightfield). Pure AI generation is not a durable moat.

---

### Slide 17 — Competitive Landscape

**Headline:**
> Every competitor solves one part. Percy solves the whole lifecycle.

**Visual:** Feature matrix table. Two groups: AI-in-existing-tools vs. automation-layer tools.

**Group A — AI Assistants in Existing Tools (help you make slides faster, same architecture)**

| Capability | Percy | MS Copilot | Claude for PPT | Google Gemini | Notion | Figma Slides |
|---|---|---|---|---|---|---|
| Team document onboarding → agentic memory | **Yes** | No | No | No | No | No |
| Bind elements to live data / Python | **Yes** | No | No | No | No | No |
| Programmatic refresh on a schedule | **Yes** | No | No | No | No | No |
| Interactive live-data output (web/HTML) | **Yes** | No | No | No | No | No |
| Visual QA and slide diffing | **Yes** | No | No | No | No | No |
| AI understands element data provenance + binding | **Yes** | Refresh (Excel/BI only) | Generate from description | Generate in Sheets only | No | No |
| Audit trail with data lineage | **Yes** | No | No | No | No | No |
| Export to .pptx | **Yes** | Native | Native | Native | **No** | Native |

**Group B — Data-Connected / Automation Tools (closer to Percy, but narrower)**

| Capability | Percy | Rollstack | Gamma | think-cell | Hex | Canva |
|---|---|---|---|---|---|---|
| Team document onboarding → agentic memory | **Yes** | No | No | No | No | No |
| Bind to arbitrary data / Python / SQL | **Yes** | BI tools only | No | Excel only | No | Sheets only |
| Programmatic refresh of live-data presentations | **Yes** | Yes (BI only) | No | Yes (Excel) | Notebooks only | No |
| Interactive live-data output (web/HTML) | **Yes** | No | No | No | No | No |
| Sandboxed Python execution | **Yes** | No | No | No | Yes (core) | No |
| Visual QA and slide diffing | **Yes** | No | No | No | No | No |
| AI understands element data provenance + binding | **Yes** | No | No | No | No | No |
| Approval workflow + audit trail | **Yes** | Partial | No | No | Enterprise | No |
| Export to .pptx | **Yes** | Yes | **No** | Yes | No | Yes |

**Talking points for this slide:**

- **Microsoft Copilot (PowerPoint)** is the most capable of the AI assistants — Agent Mode (GA April 2026) can directly update charts and data in existing slides from linked Excel or Power BI sources. This is real and useful. But it is scoped to Excel and Power BI. It cannot bind to arbitrary data sources, cannot run Python, cannot onboard an existing deck as a structured model, and cannot do visual QA. It updates charts it recognizes; it cannot model charts it didn't create. Copilot makes the old architecture faster. Percy replaces the architecture.

- **Claude for PowerPoint** (Anthropic, beta 2026) creates genuinely useful native charts from text descriptions — editable PowerPoint chart objects, not static images. It also shares Excel context across add-ins. But there is no live data connection and no refresh — once generated, a chart is inert. It cannot onboard an existing deck as a structured model and has no QA layer. It is a generation tool, not a refresh pipeline.

- **Google Slides + Gemini** can generate editable charts, but the live data connection exists in Sheets, not Slides. Charts placed in Slides do not auto-refresh when Sheets data changes. Google's data infrastructure (BigQuery, Sheets, Looker) is not wired through to the presentation layer in any programmable way.

- **Notion** is popular and has a Presentation Mode, but it cannot produce a .pptx file — a hard enterprise blocker — and has no external data binding. Notion's AI is excellent for knowledge management; it is not a reporting automation layer.

- **Figma Slides** is design-first and collaboration-friendly. It has no connection to data sources, no business reporting automation, and no path to programmatic refresh. A different use case entirely.

- **Rollstack** is Percy's closest functional neighbor: it connects Tableau, Power BI, and Looker to slides on a schedule. But it works at the BI screenshot level — it embeds a picture of a chart, not a structured element. It cannot onboard an existing customer deck, it cannot execute Python, and it has no visual QA or approval chain.

- **think-cell** is the incumbent in data-driven charting ($219/user/year, 88% of Fortune 100, 1.3M users). It binds Excel cells to PowerPoint charts manually. That binding is per-chart, requires think-cell charts to be built from scratch in their system, and has no AI, no Python, no QA, and no approval workflow. Percy can onboard existing think-cell decks and make the entire artifact programmable.

- **Prezent.ai** targets the same Fortune 2000 buyer but through brand compliance — it corrects colors and fonts, not data. Its "overnight presentations" service uses human staff, not pipelines. $400M valuation on a services-heavy business proves enterprise willingness to pay; it does not prove automated infrastructure exists.

- **Hex** is excellent for data teams and overlaps with Percy's Python-native positioning. But Hex outputs notebooks and web apps, not slides. It has no path to a PowerPoint export, no existing artifact onboarding, and no presentation approval workflow. Percy and Hex complement each other; they are not the same product.

- **Interactive outputs:** Percy's output is not a frozen file. A Percy-rendered presentation can contain live data elements — charts that update when their data source changes, filterable tables, hover-detail panels, scenario toggles, embedded live metrics. The deck is a web document that breathes with the data, not a snapshot of it. No other tool in this matrix produces this kind of output.

- **Team agentic memory:** When a team uploads their existing documents to Percy, it doesn't just import them — it decomposes each one into structured elements (chart types, table schemas, layout patterns, data references, brand tokens) and stores them in shared team memory. Percy's AI then draws on this corpus to build new things: it knows your team's chart conventions, which data sources you use, how your tables are typically structured, what your board slides look like. Combined with shared data pipelines, this creates a team-wide agentic memory system that compounds over time. No other tool approaches this.

- **The gap across all of them:** Not one competitor — not Microsoft, not Anthropic, not Google, not Notion — produces interactive live-data outputs, builds team agentic memory from existing documents, binds arbitrary data sources to structured visual elements, runs visual QA after every refresh, and audits the entire lifecycle. Those are Percy's combined claims, and none of them can be replicated by adding a Copilot subscription.

---

### Slide 18 — What Only Percy Does

**Headline:**
> The capabilities that do not exist anywhere else.

**Five specific things Percy does that no competitor offers:**

**1. Team agentic memory built from existing documents**
Getting a team onto Percy takes five minutes: upload your existing decks. Percy decomposes each document into structured elements — chart types, table schemas, layout patterns, data references, brand tokens, recurring metrics — and stores them in shared team memory. From that point, Percy's AI builds with institutional knowledge: it knows how your team structures board slides, which data sources feed which charts, what your QBR tables look like, how your brand system works in practice. Combined with shared data pipelines, this creates a compounding team-wide agentic memory that improves with every document added. Every other tool starts from zero every time. Percy learns the organization.

**2. AI that operates on structure, not screenshots**
When Microsoft Copilot edits a slide, it sees text and layout. When Rollstack's automation runs, it embeds a picture of a Tableau chart. When Gamma generates content, it sees a prompt. When Percy's AI operates on a deck, it sees the Bridge element model — the actual data binding, the chart type, the underlying series values, the formatting rules, the element's provenance. Percy can ask: "Is this chart using the right data source?" "Has this metric changed since last quarter?" "Does this element's value match what the Python snippet would produce?" No other tool — not Microsoft, not Anthropic, not Google — can ask those questions, because no other tool has the structured element model underneath.

**3. Visual QA and diffing**
After every programmatic refresh, Percy renders a before/after comparison of every affected slide and flags visual regressions for human review. A number that changed unexpectedly, a chart that shifted layout, a table that gained a row — these are caught before the deck ships. No competitor offers this. Rollstack refreshes slides; it does not verify them. think-cell updates charts; it does not diff them. AI assistants like Copilot and Gemini generate changes; they do not test them. Percy treats every refresh as a testable output with a reviewable diff.

**4. Python inside the presentation layer**
Percy brings Python — the language where modern data work, analytics, and AI already happen — into the presentation refresh lifecycle. A data engineer can write a pandas transformation that feeds a chart. A quant analyst can attach a Python snippet to a table that computes from a model output. A data science team can bind a forecast visualization to the same code that runs in their pipeline. Microsoft Copilot can write Python code in a chat window. Percy executes it inside the slide refresh job. The difference is the difference between a suggestion and an infrastructure primitive.

**5. Outputs that live with the data**
A Percy presentation is not a frozen file. It is a web document where every bound element stays alive: charts that update when their data source changes, tables that re-sort and re-filter, metric tiles that pull live values, scenario toggles that let a viewer switch between assumptions, hover-detail panels that expose the underlying data on demand. The audience is not looking at a snapshot of what was true when the analyst hit export — they are looking at what is true now. This is a different category of business communication, and no other presentation tool produces it.

**6. The full lifecycle in one platform**
Five minutes to onboard → structured element model built from your documents → elements bound to data and Python → scheduled or triggered refresh jobs → visual QA diff after every run → approval workflow → publish as interactive web output or export to PowerPoint and PDF → version history and audit trail. Microsoft's stack splits this across Copilot, Power Automate, Power BI, and SharePoint — four products with no shared data model. Percy is the first platform designed to handle the entire lifecycle in one place, because business storytelling deserves an operating system, not a collection of disconnected point tools.

---

### Slide 19 — The Ask

_Audience-dependent. Placeholder._

**For investors:**
> We are building the missing infrastructure layer for business communication. The market is every organization that produces recurring reporting. We are raising [X] to [milestone].

**For enterprise customers:**
> Percy is in early access. We are working with a small number of organizations to onboard their existing reporting artifacts and build the refresh workflows that make the most sense for their teams. If that sounds like your organization, let's talk.

**For recruits:**
> We are building infrastructure that has not existed before. The problem is real, the timing is right, and the team is small. If you want to work on something that matters to every organization that runs on data, come talk to us.

---

## Design Notes

**Typography:** Medium-bold geometric sans-serif. Confident weight. Squared terminals. Linear / Vercel aesthetic — precise, dark-capable, enterprise-grade.

**Color:** Black on white throughout. No gradients, no illustration, no stock photography. The restraint is the statement.

**Slide density:** Most slides should breathe. The data timeline is the one exception — density there is intentional and makes the argument.

**Tone:** Not a consumer pitch. Not a VC buzzword deck. The tone is: we understand the problem better than anyone, and we have built the right foundation to solve it. Confident, measured, specific.

**The phrase "business storytelling":** Use it consistently. It elevates the problem from "slide formatting" to a distinct category of knowledge work that deserves its own infrastructure. It is a differentiating frame.

---

## Key Lines (Use These Verbatim)

- _"Percy is the missing operating layer between data, AI, and business storytelling."_
- _"The deck is not the source of truth. It should be a rendered result."_
- _"Business storytelling is the last form of knowledge work without an operating system."_
- _"The final boss for data visualization and reporting."_
- _"Every visual element becomes structured, inspectable, and programmable."_
- _"A canvas where every element is also a program."_
- _"Built for the people who produce truth and have to package it too."_
- _"Not just decks. Not just dashboards. Not just templates."_
- _"The organization that knows itself."_
- _"Knowledge that stays when people go."_
- _"When data changes, the people who need to know — know."_
- _"Consistency is not a process. It is enforced by the architecture."_
