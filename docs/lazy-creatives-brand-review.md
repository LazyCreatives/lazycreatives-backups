# Lazy Creatives — Brand Change Review

**Reviewed:** 9 Jun 2026 · public repos under [github.com/LazyCreatives](https://github.com/LazyCreatives)
**Source of truth:** `lazycreatives.github.io/brand-guide.html` (Brand Sheet v2) + `/brand.css`
**Brand goals checked against:** "Looks lazy, works obsessively" · headphone-sloth mark in single-colour **Sloth Blue (#86B3D3)** · gold demoted to warnings only · house architecture "Lazy Creatives — <Tool>" · chill voice / rigorous claims.

## Verdict

The **marketing layer is sound and on-brand** — homepage and both tool landing/pricing pages are live, share `/brand.css`, use the sloth logo, correct "Lazy Creatives — <Tool>" naming, and consistent SEO/OG tags. Nicely done.

The problem is a **half-finished rebrand**. The brand moved from a v1 "gold shield + waveform" identity to the v2 Sloth-Blue sloth identity, but the migration only reached the website and the *Backups* app theme. The **product UIs still carry the old gold identity**, and there's leftover/duplicated brand material. So the apps don't yet match the company's stated identity.

## Findings (highest priority first)

### 1. HIGH — The in-app logo is off-brand in *both* apps
`electron/src/components/BrandMark.tsx` (and `brand/logo-mark.svg`, plus Backups' `brand/logo-lockup.svg`) render a **gold shield with a gold waveform** and a green check/arrow. There is **no sloth anywhere in the app's logo**, and it leads with gold.

This contradicts the brand sheet directly:
- "One sloth, one wordmark … never a new logo"; logo = headphone sloth, single-colour Sloth Blue.
- Usage → Don't: "Recolour, redraw, or re-typeset the logo"; "Use gold as a primary CTA."

The mascot is the heart of "looks lazy" — and it's absent from the actual product. Even Backups, whose colours were migrated, still ships this gold-shield mark (its own code comment calls it "a gold waveform").

### 2. HIGH — The Uploader app is still on the old gold theme
`lazycreatives-uploader/electron/src/theme.css` sets `--accent: #F5C451` ("Signal Gold") as the **primary CTA colour**. The brand sheet says gold is "no longer the lead — attention/warnings only" and explicitly lists gold-as-primary-CTA under Don't.

The Uploader palette has also drifted from canon across the board: `--text #F3F4F6` (canon Ink `#EAF1F7`), `--danger #FF5D5D` (canon Clip Red `#F2706E`), `--text-dim #9AA1AB` (canon Muted `#9DB0C0`). Net effect: the **Uploader marketing page (blue) contradicts the Uploader app (gold)** — same product, two identities. (Backups' `theme.css`, by contrast, was correctly migrated to Sloth Blue — use it as the template.)

### 3. MED — Stale duplicate brand guide in the Backups repo
`lazycreatives-backups/brand/brand-guide.html` is a divergent older copy of the brand sheet (its mascot section predates the "Napping + Magnifier delivered" update). The whole point of the setup is **one** brand sheet in `lazycreatives.github.io`. Delete the copy and link to the canonical URL instead, or it will keep drifting.

### 4. MED — The brand's UI font (Inter) isn't actually loaded on the web
The brand sheet mandates **Inter** for UI/body, but no page has an `@font-face` or font-CDN link for it, and `--font` lists system fonts first with Inter fourth. So every web page silently falls back to system fonts — the specified typography isn't shipping. Either self-host/import Inter or update the guide to say "system UI stack."

### 5. LOW–MED — The homepage doesn't use the design system it introduced
`lazycreatives.github.io/index.html` still uses an **inline copy** of the palette instead of linking `/brand.css`. Its `:root` is missing `--gold`, `--red`, `--blue-press` and uses a slightly different background gradient. Drift risk at the front door; migrate it to `/brand.css` like the tool pages.

### 6. LOW — Logo asset handled two different ways
Backups pages reference a **relative, duplicated** `brand/logo.png`; Uploader references the canonical absolute `https://lazycreatives.github.io/logo.png`. Standardise on the absolute URL so a logo update propagates everywhere (and the duplicate copy can't go stale).

### 7. LOW — Copy claim is described inconsistently
Org README says samples are relinked "by **content**, not just filename"; Backups homepage card says "matched by **file size**, not just name." Content-hash vs file-size are different (and file-size is the weaker claim). Pick one accurate wording — "looks lazy, works obsessively" depends on claims staying rigorous.

### 8. WATCH (already flagged by you) — Slothy Jelly font licence
Display font is free for personal use only; a commercial/web licence is required before shipping. Not currently violated (the `.woff2` isn't committed), but it's a launch blocker if the wordmark ever renders in the product or web font.

## Suggested order of fixes
1. Redraw the app `BrandMark` / `logo-mark.svg` as the Sloth-Blue sloth (kills #1 in both apps).
2. Repoint Uploader `theme.css` to the Backups (Sloth-Blue) token set (#2).
3. Delete the duplicate brand guide in Backups; link the canonical one (#3).
4. Load Inter (or amend the guide) (#4); migrate homepage to `/brand.css` (#5); standardise the logo URL (#6); fix the relink-claim wording (#7).

## What's already good
Live, on-brand marketing on all three pages · correct house-brand naming and OG/JSON-LD · Backups app fully migrated to Sloth Blue · gold correctly demoted to `--warn` in Backups · voice is chill with specific, verifiable claims.
