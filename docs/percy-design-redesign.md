# Percy Design System — Redesign Proposal

A proposal to evolve Percy's visual language from "Bloomberg-terminal precision" to "studio-grade craft." The goal is to feel as immediate, modern, and human as Figma, Notion, and Linear, while keeping the seriousness and density our enterprise users (asset managers, finance teams, strategy groups) actually need.

This doc covers:
1. Honest critique of what we have today
2. What modern design-studio apps do that we don't
3. The proposed new design language ("Studio Refined")
4. Concrete tokens and components
5. Five accompanying HTML mockups in `design-mockups/`

---

## 1. The current state, plainly

Percy today reads as **"Suit-and-Tie monochrome"** — a deliberately formal, dense, museum-y aesthetic. The system makes specific moves:

| Decision | What it produces |
|---|---|
| 10–12px text everywhere | Information density, but everything looks like a footnote |
| Heavy `letter-spacing: 0.16em–0.32em` uppercase | Newspaper / Gilded Age formality, fatiguing to read |
| Hairline borders only | Architectural precision, but feels inert and grid-like |
| Champagne + monochrome palette | Restrained, but every screen reads the same |
| 12-pixel-tall top bar | Almost punitive density |
| Roman numerals (I, II, III) for proof points | Almost performatively old-fashioned |
| `Established 2026` watermark | Reads as artisanal product page, not software tool |
| Unicode glyphs (`▾`, `·`) for UI | Feels dated next to icon systems |

**The result is internally consistent** — credit where due, the system holds together. But it tells a specific story: *this is a serious product made for serious people, formally dressed.* That story works for an investment bank's research portal. It works less well for a tool the user is going to spend eight hours a day inside, building things.

Compare what a user *feels* opening Percy versus opening Figma:

- **Percy**: "I am about to read a quarterly report."
- **Figma**: "I am about to make something."

Percy is a **making tool**. The aesthetic should signal that.

---

## 2. What modern design-studio apps do well

### Figma
- **Type**: Inter throughout, with a custom display variant for headlines. **Sentence case** for nearly all UI labels.
- **Spacing**: generous in marketing, breathable in the app shell. Top bar is ~48px.
- **Color**: vibrant primary (Figma's purple-pink), **soft pastels for file/project tags**, neutral grays everywhere else.
- **Surfaces**: card-based file browser with **thumbnail previews**. Soft shadows on hover, subtle 1px borders that lighten on hover.
- **Iconography**: 16px outlined, friendly, custom set; never Unicode glyphs.
- **Marketing site**: huge typography (96–120px headlines), bento-grid feature blocks, gradient accents.

### Notion
- **Type**: Inter (or system) for body, occasional serif for documents. Sentence case everywhere.
- **Spacing**: documenty — wide margins on pages, comfortable line-height (1.5–1.65).
- **Color**: very neutral overall, but **emoji and color tags carry personality**. Pages can have personal cover images.
- **Surfaces**: minimal — borders only when necessary. Hover-reveal drag handles for blocks.
- **Iconography**: emoji + Lucide-style icons. Crucially, each project/page gets its own icon, which becomes a personality marker.
- **Tone**: warm, friendly, never aggressive. Empty states feel inviting.

### Linear
- **Type**: Inter, with their own custom variant for the wordmark. Title case for column headers, sentence case for buttons.
- **Spacing**: dense but never cramped. Generous padding on cards.
- **Color**: dark mode native, refined. Purple accent for primary actions. **Status colors are essential** — every issue has a color-coded state pill.
- **Surfaces**: subtle frosted-glass panels on dark, near-black background. Soft shadows. Beautifully animated state transitions.
- **Iconography**: 14–16px outlined, consistent stroke width.
- **Density philosophy**: every pixel earns its place, but breathing room comes from *vertical* spacing in lists.

### Vercel
- **Type**: Geist (their own), large headlines (60–80px), small caps occasionally for metadata.
- **Spacing**: marketing pages are **very** generous; app pages use a strict 4/8/12/16/24/32/48 scale.
- **Color**: black + white + one bold accent (electric blue or purple gradient on CTAs). Subtle gradient backgrounds.
- **Surfaces**: floating cards with `rgba(0,0,0,0.04)` shadows. Subtle gradients on hover.
- **Iconography**: outlined, 16–20px.

### Tome / Gamma / Pitch
- **Type**: large, friendly. Inter or DM Sans.
- **Spacing**: marketing-heavy, lots of negative space.
- **Color**: bold and playful (pinks, purples, bright accents).
- **Surfaces**: soft shadows, rounded cards.
- **Tone**: AI-first prompt boxes are huge focal points.

### Common 2026 patterns
- **Bento-box marketing pages** — feature cards in asymmetric grids with mixed sizes.
- **Subtle gradients on CTAs** — primary buttons get a 2-stop gradient, hover state shifts the gradient.
- **Soft shadows over hairlines** — surfaces float gently rather than being grid-locked.
- **Sentence case everywhere** — uppercase reserved for tiny eyebrow labels (and even then, sparingly).
- **Status pills with desaturated color fills** — `bg-green-50 text-green-700` aesthetic for "shipped," "building," etc.
- **Avatar groups** — overlapping circles with initials/photos for collaborators.
- **Hover-reveal interactions** — secondary actions hide until hover, keeping default state quiet.
- **Friendly empty states** — illustration + one-line CTA, never a wall of text.

---

## 3. The proposed direction: "Studio Refined"

A synthesis of:
- **Linear's** precision and density
- **Notion's** warmth and approachability
- **Vercel's** typographic confidence
- **Figma's** card-based browseability

Plus what's already good about Percy that we should keep:
- The mark itself (the hand-drawn ∅) — this is genuinely distinctive
- The monochrome discipline (we just need *more* of it: more whites, more breathing)
- The champagne + verdigris palette — sophisticated, recognizable
- The serious, considered voice in copy

**What changes:**

| Today | Proposed |
|---|---|
| 10–12px text default | 14–15px text default |
| `0.18em` uppercase tracking on most labels | Sentence case; reserve uppercase for 11px eyebrows only |
| Hairline borders everywhere | Soft shadows + selective hairlines |
| 12px top bar | 56–64px top bar |
| Roman numerals, "Established 2026" | Direct, modern copy; no quaint affectations |
| Champagne as occasional accent | Champagne for primary CTAs, verdigris for "data alive" moments, gray for everything else |
| Dark-mode-native | Light mode default, dark mode equally polished |
| Unicode `▾ ·` symbols | Lucide icons (16/20/24px sizes) |
| Tables as default for project lists | Cards with thumbnails as default; table view available |
| Single layout density | Three densities: studio (compact), app (default), marketing (generous) |

**What stays:**

- The Percy mark and wordmark
- The voice of copy ("Built for the people who produce truth and have to package it too")
- The seriousness — we're not going playful, we're going *refined*
- The champagne/verdigris palette
- The dark mode (still gorgeous, just no longer the only mode)

---

## 4. The token system

### Color (light mode default)

```
Surfaces
  --bg-base       #FAFAF7    (warm paper)
  --bg-surface    #FFFFFF    (card / panel)
  --bg-sunk       #F4F4EE    (inset / inputs)
  --bg-overlay    rgba(248,246,239,0.8)  (glass)

Text
  --text-primary    #1A1A18  (near-black, warm)
  --text-secondary  #5C5C56  (mid-gray)
  --text-tertiary   #8A8A85  (light gray)
  --text-on-accent  #1A1A18  (dark text on champagne)

Borders
  --border-subtle   rgba(26,26,24,0.08)
  --border-default  rgba(26,26,24,0.14)
  --border-strong   rgba(26,26,24,0.24)

Accent (champagne — primary)
  --accent-50       #FAF3DC
  --accent-100      #F5E7B7
  --accent-500      #C29C45    (primary)
  --accent-600      #A98432
  --accent-700      #8B6822

Accent (verdigris — data / live)
  --data-50         #DEF1ED
  --data-500        #2E6E66
  --data-600        #265B54

Status
  --status-success  #4F8255    (sage)
  --status-warning  #B47F2E    (ochre)
  --status-error    #97402E    (brick)

Shadows
  --shadow-card     0 1px 3px rgba(26,26,24,0.06), 0 1px 2px rgba(26,26,24,0.04)
  --shadow-pop      0 8px 24px rgba(26,26,24,0.12), 0 2px 6px rgba(26,26,24,0.06)
  --shadow-modal    0 24px 48px rgba(26,26,24,0.18), 0 12px 24px rgba(26,26,24,0.10)
```

Dark mode mirrors with the existing tokens — `ink/paper/muted/edge/champagne/verdigris` already defined.

### Type

- **Primary**: Inter Variable. Use Tabular Nums for numeric data.
- **Display headlines**: Inter Display variant (or fall back to Inter at heavier weight).
- **Mono**: JetBrains Mono for code / data values.

```
Type scale
  display-1   72px / 1.05 / weight 600  (marketing hero)
  display-2   56px / 1.08 / weight 600
  display-3   40px / 1.15 / weight 600
  h1          32px / 1.2  / weight 600
  h2          24px / 1.3  / weight 600
  h3          20px / 1.4  / weight 600
  body-lg     17px / 1.6  / weight 400
  body        15px / 1.6  / weight 400  (DEFAULT)
  body-sm     13px / 1.5  / weight 400
  label       11px / 1.4  / weight 600  (uppercase, only for eyebrows)
  mono-sm     13px / 1.5  / weight 400  (JetBrains Mono)
```

### Spacing

```
Spacing scale (px)
  1   2
  2   4
  3   8
  4   12
  5   16
  6   24
  7   32
  8   48
  9   64
  10  96
  11  128
```

Cards: padding 24px (interior), gap 16–24px between cards.
Form inputs: 12px vertical / 16px horizontal padding, 6px corner radius.
Buttons: 10px vertical / 16px horizontal padding (sm), 12/20 (md), 16/28 (lg).

### Radius

```
  --radius-sm    4px    (chips, tiny pills)
  --radius-md    6px    (inputs, buttons)
  --radius-lg    10px   (cards, panels)
  --radius-xl    16px   (modals, large surfaces)
```

### Iconography

Adopt **Lucide** as the primary icon system. 16px in dense contexts, 20px default, 24px for primary navigation. Replace every Unicode glyph (`▾ · ⌐ ‹›`) with a Lucide icon. Strokewidth `1.5px` everywhere for consistency.

---

## 5. Component principles

### Buttons

Three sizes (sm/md/lg). Three intents: **primary** (champagne fill), **secondary** (paper with border), **ghost** (transparent, hover-fill). Primary button gets a subtle `linear-gradient(180deg, #C29C45 0%, #A98432 100%)` and a 1px inset highlight on top — gives it a tactile, slightly-raised feel without being skeuomorphic.

```
.btn-primary {
  background: linear-gradient(180deg, var(--accent-500), var(--accent-600));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.16),
    0 1px 2px rgba(0,0,0,0.08);
  color: var(--text-on-accent);
  font-weight: 500;
  letter-spacing: -0.01em;   /* note: NEGATIVE tracking, not positive */
}
```

### Cards

Soft shadow + tight border. Radius 10. Padding 24. Interactive cards lift on hover (shadow grows, transform `translateY(-1px)`). Project cards have a 16:9 thumbnail at the top, metadata below.

### Status pills

Desaturated fill + matching text color:
```
.pill-success { background: #E6F0E8; color: #2F5A36; }
.pill-warning { background: #F4EAD3; color: #6B4915; }
.pill-data    { background: #DEF1ED; color: #1F4E48; }
```

### Empty states

Always: small mark/illustration → 1-sentence hint → 1 CTA. Never a wall of text. Friendly tone.

### Top bar

56px tall. Logo + workspace switcher on the left. Center: optional breadcrumb. Right: search trigger (with `⌘K` shortcut hint), notifications icon, avatar.

### Sidebar

240px wide on the dashboard, collapsible to 56px. Sections separated by 11px uppercase eyebrows with 16px gap. Active item: champagne 4px left rail + champagne text. Hover: surface fill at 40% opacity.

### Project gallery

Default to **gallery view with thumbnail cards** (3-up on wide screens, 2-up on tablets, 1-up on mobile). Toggle to a **list view** for power users. Thumbnail shows last rendered slide; metadata row below: project name, owner avatar, "Updated 2 hours ago", small status pill.

### Studio (editor) shell

- Top bar: 56px. Left: project name + breadcrumb. Center: refresh status. Right: avatar group (collaborators) + share button.
- Left rail: collapsible layer/element tree, 280px wide.
- Right rail: inspector panel, 320px wide. Tabbed sections (Properties / Data / History).
- Center: canvas, white surface with 1px subtle border, soft shadow underneath suggesting it's a physical artifact.
- Bottom bar: zoom controls + slide picker.

---

## 6. Recommended copy changes

The existing voice has good moments and stuffy moments. Some edits:

| Today | Proposed |
|---|---|
| "Established 2026" | (delete) |
| "I, II, III" Roman numerals on proof points | "01 / 02 / 03" or just remove numbering |
| "For the people who tell the story." (footer aside) | (keep — this one lands) |
| "Quantitative researcher, asset management" | (keep — credibility) |
| All-caps eyebrow labels everywhere | Keep eyebrows but use them sparingly, max one per section |

The "Suit and Tie" voice can stay in *copy*; it just shouldn't be reflected in *layout density*.

---

## 7. The five mockups

In `docs/design-mockups/`:

1. **`01-landing.html`** — Marketing hero, feature bento, CTA. The new way the homepage / Splash should feel.
2. **`02-dashboard.html`** — Logged-in app dashboard with sidebar, recent projects as cards, activity feed.
3. **`03-studio.html`** — The Studio editor with toolbar, canvas, inspector. Shows the working surface.
4. **`04-components.html`** — Full design-system showcase: typography, buttons, inputs, cards, pills, modals, toasts.
5. **`05-project-detail.html`** — A project detail / inspector page showing how data, metadata, refresh history feel in the new system.

Open them directly in a browser. They're standalone HTML, no build step, no dependencies. Each loads Inter from Google Fonts.

---

## 8. Migration thinking

If you sign off on this direction, the lowest-risk path is:

1. **Tokens first** — update `index.css` with the new palette and spacing scale. Keep dark-mode tokens working in parallel. (Half-day.)
2. **Top bar + Splash** — these are the most visible "Bloomberg" moments today. Reskin them in the new system. (One day.)
3. **Dashboard projects gallery** — move from list to card grid. (One day.)
4. **Buttons + form inputs** — replace existing components with the new ones. (Half-day.)
5. **Studio shell** — toolbar, inspector, canvas surface. (Two days.)
6. **Marketing/Splash polish** — hero, feature blocks, gradients. (One day.)

Total: ~5–6 days of frontend work for a complete coat-of-paint pass. The component library (`04-components.html`) becomes the source of truth during the migration.

---

## 9. What we're choosing not to do

- **No glassmorphism.** It's overdone in 2026 and doesn't suit a serious tool.
- **No big illustrated empty states with cartoon characters.** Stay refined. Use the Percy mark itself + a one-liner.
- **No multi-color "playful" iconography.** Lucide outlined, monotone, consistent.
- **No marketing-style animations in the app.** Subtle hover transitions, focus rings, loaders. That's it.
- **No emoji-as-icon system.** Notion can do it because Notion is for everything; Percy is for one specific thing and should look like it knows what it is.

---

## 10. Open question for you

The mockups commit to **light mode as the new default**, with dark mode preserved as an option. The current app defaults to dark. This is the single biggest visual shift, and it's a real choice — Linear is dark-default, Notion is light-default, Figma is light-default.

The argument for light-default: closer to the actual presentation surface (white slides on white background = WYSIWYG), better for screenshots/marketing/onboarding, more approachable to first-time users, what every other design tool does.

The argument for dark-default: more sophisticated, easier on the eyes for long sessions, what financial pros actually use, Percy already does it well.

I'd default light, allow dark, and let the user pick. But this is a brand call.

---

End of doc. Open the five HTML mockups in `design-mockups/` to see this come alive.

---

## Appendix — Color / personality variations

Five alternative directions, each shown as the same dashboard view in `design-mockups/variations/`. Open `variations/index.html` and use keys 1–5 to flip between them.

| Code | Direction | Mood | Reference |
|---|---|---|---|
| **A** | Champagne Light | Warm cream paper + gold accent | "Quiet luxury" — Vanguard, boutique wealth |
| **B** | Carbon Dark | Near-black + champagne with subtle glow | Linear, Vercel, premium infra |
| **C** | Indigo Trust | Cool cream + Stripe-purple accent | Stripe, fintech SaaS norm |
| **D** | Verdigris | Warm cream + teal-as-primary | Distinctive, editorial-modern |
| **E** | Editorial Serif | Same as A but Fraunces serif headlines | Bloomberg Markets, Financial Times |

**Research recommendation (B + D):**

- **B Carbon Dark** is the safest "premium confidence" move. Maximizes contrast for live data on the canvas, reads premium instantly, works equally well across asset managers, quants, and finance teams. This is what Linear has proven works for serious technical users.
- **D Verdigris** is the differentiation play. Teal isn't crowded in finance the way blue/purple are. Builds memory. The risk is that it reads "less financial" until users internalize the mark — but for a brand that already has a distinctive ∅ mark, leaning into a less-expected accent could be the right move.

**Skip:**
- C (Indigo) — too me-too with Stripe; hard to own a distinct identity in a crowded blue/purple finance-SaaS palette.
- A (Champagne Light) by itself — works only if execution stays pristine; can drift toward "boutique" or "dated" easily.
- E (Editorial Serif) — only works if the entire product is editorial-first; for an app you spend 8 hours in, the serif fatigue can creep in.

**My push:** Pick **B as the app shell** (dark by default, where users actually work) and use **D's verdigris** as the data accent inside it. Keep champagne for the marketing site / Splash and as the primary CTA color even on dark — it's the brand color. So the integrated palette would be:

- **App background**: carbon dark (#0E0E0D / #18181B)
- **Primary action**: champagne (#D9B264 → #C29C45 gradient)
- **Data / live indicators**: verdigris (#4FA095)
- **Marketing site**: warm light paper (variation A's palette) — gives the marketing pages a friendlier, more inviting first impression than the in-app experience

That gives you the right of *both* recommended directions — premium dark for working, warm light for first impressions. The brand mark and copy voice carry continuity between them.
