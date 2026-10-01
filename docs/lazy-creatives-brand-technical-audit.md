# Lazy Creatives — Technical Brand Audit

**Scope:** the brand system *itself* — palette values, contrast, color roles, token architecture, type/scale — judged against WCAG 2.1/2.2 and the published guidance of Material 3, Apple HIG, IBM Carbon, Radix Colors and Tailwind. Contrast ratios below are **computed** (sRGB relative luminance, WCAG formula), not estimated.
**Inputs:** `brand-guide.html` (Brand Sheet v2), `brand.css`, and the two app `theme.css` files.

---

## Verdict in one line

The **color choices are good and the dark-mode instincts are right** — but this is currently a *palette*, not a *design system*. The hues are well-chosen and mostly score AAA, yet the system is missing tonal ramps, a real token hierarchy, and defined interaction/border roles. Two specific color values also fail WCAG, and one is already contradicted between files.

---

## 1. Accessibility — computed contrast (WCAG)

WCAG thresholds: **AA** = 4.5:1 body / 3:1 large; **AAA** = 7:1 / 4.5:1; **non-text UI (1.4.11)** = 3:1 for component boundaries, icons, focus rings.

| Pairing | Ratio | Normal text |
|---|---|---|
| Ink `#EAF1F7` on Studio Black `#0A0B0D` | **17.27:1** | AAA |
| Ink on Console `#141A20` | 15.37:1 | AAA |
| Muted `#9DB0C0` on Studio Black | 8.82:1 | AAA |
| Muted on Console | 7.85:1 | AAA |
| Sloth Blue `#86B3D3` text on Studio Black | 8.82:1 | AAA |
| Near-black on Sloth Blue fill (primary button) | 8.82:1 | AAA |
| Near-black on Verified Green `#4ADE80` fill | 11.30:1 | AAA |
| Near-black on Attention Gold `#F5C451` fill | 12.09:1 | AAA |
| Verified Green text on Console (status/mono) | 10.06:1 | AAA |
| Gold text on Console (warning) | 10.76:1 | AAA |
| Clip Red `#F2706E` text on Console | 6.11:1 | AA |
| **Sloth Blue text on Deep Slate `#3B4F5D`** | **3.82:1** | **FAIL** (AA-large only) |
| **Ink/white text on Clip Red `#F2706E` fill** | **2.52:1** | **FAIL** |
| **Deep Slate `#3B4F5D` as a border on Studio Black** | **2.31:1** | **FAIL (1.4.11, needs 3:1)** |

**Three real failures:**

- **A. Clip Red can't carry white text — 2.52:1.** `#F2706E` is a light coral. The universal convention for destructive/error buttons is a red fill with *white* text — that combination fails here. Dark text on it passes (6.86:1), but dark-on-red looks like a warning, not a danger. **Fix:** add a darker red for solid error surfaces (≈ `#C8403E`, which clears 4.5:1 with white) and keep `#F2706E` for *text/icons on dark* only.
- **B. Deep Slate borders are invisible to spec — 2.31:1.** The guide assigns Deep Slate to "borders, ghost buttons," but as a UI boundary on Studio Black it fails the 3:1 non-text rule ([WCAG 1.4.11](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)). The actual `--line` token (`rgba(134,179,211,.16)`) and the app's `--border #243039` are *lower still*. Decorative card edges are exempt, but **input outlines, focus rings, toggles and ghost-button borders are not.** Fix: define a dedicated interactive-border token at ≥3:1 (a solid light slate, not a 16%-alpha line).
- **C. Sloth Blue on Deep Slate — 3.82:1.** Your guide already says "don't" — confirmed correct; keep that rule explicit in code, not just prose.

Everything else is comfortably AAA. The dark base and the desaturated Sloth Blue are exactly what Apple HIG and Material recommend for dark UI — muted/desaturated accents read better on dark and reduce eye strain ([Apple HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode), [Material](https://m2.material.io/design/color/dark-theme.html)).

---

## 2. The palette has no tonal ramps

Every brand hue is defined as **a single value**. Mature systems define a *ramp* per hue so the UI has principled steps for hover, pressed, disabled, borders, subtle fills and text-on-tint:

- **Material 3** — each key color expands to a **13-tone** tonal palette (0–100). ([source](https://m3.material.io/styles/color/overview))
- **Tailwind** — **11 steps** (50–950). **Radix** — **12 steps** with fixed semantic roles per step.

Lazy Creatives has one `#86B3D3`, one `#4ADE80`, etc., plus *ad-hoc* press values invented per file. The only thing that *is* a proper ramp is the neutral surface set — Studio Black → Console → Panel → `surface-3` — which is a reasonable 4-step elevation ladder and aligns with Material 3's tone-based surfaces (lighter = higher elevation). ([M3 tone-based surfaces](https://m3.material.io/blog/tone-based-surface-color-m3))

**Fix:** generate a 9–12 step ramp for Sloth Blue, Green, Gold and Red (and a neutral ramp), and derive all states from named steps instead of one-off hexes.

---

## 3. Token architecture — the core technical gap

Best practice is a **three-tier** token model: **primitives** (raw hex) → **semantic/alias** (purpose: `accent`, `surface`, `danger`) → **component**. Semantic tokens alias primitives so a brand change touches one layer and propagates everywhere. ([Tailwind v4 token tiers](https://www.maviklabs.com/blog/design-tokens-tailwind-v4-2026/))

Lazy Creatives has none of this wired together:

| | `brand.css` (web) | app `theme.css` | Problem |
|---|---|---|---|
| Naming style | **primitive** (`--blue`, `--green`, `--gold`) | **semantic** (`--accent`, `--danger`, `--warn`) | Two different vocabularies for one brand |
| Aliasing | none — primitives used directly in components | hexes hardcoded into semantic tokens | No shared source; nothing references a single primitive set |
| Same concept, different name | `--ink` / `--muted` / `--line` / `--blue-press` | `--text` / `--text-dim` / `--border` / `--accent-press` | Tokens can't be shared across web and app |

The consequence is not hypothetical — it's exactly why the rebrand drifted: because each app hardcodes its own `--accent`, **Backups set it to Sloth Blue and Uploader left it as gold**, and nothing forced them to agree. A proper alias layer (`--accent → --blue-500`) makes that split structurally impossible.

**Fix:** one primitives file (the ramps from §2), one semantic layer that aliases them (`accent/surface/text/border/success/warning/danger`), and have *both* the website and both apps consume it. Pick one naming set and retire the other.

---

## 4. Interaction states are undefined / contradictory

- **Pressed state goes opposite directions.** `brand.css` lightens blue on press (`--blue-press #9bc0e0`, luminance 0.50 vs base 0.42); the apps darken it (`--accent-press #6C9BBE`, luminance 0.30). One brand, two opposite interaction models, neither documented in the brand sheet.
- **No tokens for disabled, focus, or hover-vs-press distinctions.** Material/Tailwind handle this with explicit ramp steps or state-layer overlays. Define them once.
- **Focus rings** must hit 3:1 (1.4.11). Sloth Blue does on dark; just make sure the focus token isn't the faint `--line`.

---

## 5. Neutrals & dark-mode technique — mostly right

- **Not pure black — good.** `#0A0B0D` is near-black, matching the principle behind Material's `#121212` baseline (pure black makes elevation shadows invisible). You sit slightly *darker* than `#121212`; consider lifting the base a touch so the tonal elevation ladder reads more clearly. ([Material dark theme](https://m2.material.io/design/color/dark-theme.html))
- **Tone-based elevation present** (surfaces lighten with elevation) — aligned with M3.
- Green and Gold are quite saturated; fine as small accents/fills, but avoid large saturated-green fills (they "vibrate" on dark). Sloth Blue's desaturation is the right call.

---

## 6. Typography & other scales

- **The brand UI font (Inter) is never actually loaded** on the web — no `@font-face`/CDN link, and `--font` lists system fonts ahead of Inter. So the specified type isn't shipping; pages fall back to the system stack. Either self-host Inter or change the guide to declare a system stack.
- **No type-scale, spacing, or radius tokens on the web.** Sizes are scattered inline `clamp()`s; radii are ad-hoc (11/14/16/18px in `brand.css`) while the apps *do* tokenize (`--radius 12 / --radius-lg 16`). Same drift pattern as colors — define a shared scale.
- **Mono for hashes/counts/status is a good, on-brand technical choice** — it reinforces "works obsessively / claims are rigorous."

---

## 7. Scorecard

| Dimension | Grade | Note |
|---|---|---|
| Hue selection & dark-mode fit | A | Desaturated accent, near-black base, tone elevation |
| Text contrast (primary pairings) | A | Mostly AAA |
| Color-role correctness | C | Red fails on white; slate borders fail 1.4.11 |
| Tonal ramps | D | Single value per hue; only neutrals laddered |
| Token architecture | D | No primitive→semantic→component tiers; web vs app diverge |
| Interaction-state system | C− | Press direction conflicts; no disabled/focus tokens |
| Type/space/radius system | C | Inter not loaded; scales untokenized on web |
| **Overall** | **C+ palette, not yet a system** | Good taste, incomplete engineering |

---

## 8. Priority fixes

1. **Fix the two failing color roles** (red-for-white-text; an interactive border token ≥3:1). *Accessibility — do first.*
2. **Generate tonal ramps** for the five hues + neutrals (Radix/Tailwind/M3 style).
3. **Build a real token hierarchy** — primitives → semantic aliases → component — and have the website and both apps consume the *same* semantic layer. This also closes the gold/blue drift permanently.
4. **Define interaction-state tokens** (hover/press/disabled/focus) with one agreed direction.
5. **Load Inter (or amend the guide)** and tokenize type/spacing/radius.

None of this changes your *look* — Sloth Blue on near-black with a green "verified" state stays. It turns the look into something that can't drift and that passes accessibility everywhere.
