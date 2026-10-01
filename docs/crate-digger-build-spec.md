# Crate Digger — Build & Handoff Spec

**Feature:** a "crate digging" browser for the user's projects in **Lazy Creatives — Backups**. Two levels: a shelf of 3D **crates** (grouped + sortable), and a **dig** view where you flip through genre-coloured **vinyl** records with the selected one spinning like a turntable. The flat project list stays the default; this is an opt-in view toggle.

**Audience:** the engineer/agent implementing it. Assumes the existing stack: Electron + React + TypeScript + Vite, the catalog backend (`backend/ablebackup/catalog.py`), and the design tokens from the token spec.

**Motion north star:** *"Looks lazy. Works obsessively."* Motion is slow, soft, and unhurried (heavy ease-out, no springy overshoot except one tiny "verified" pop). It is also rigorous: 60fps, transform/opacity only, and fully gated behind `prefers-reduced-motion`. Delight by default, never at the cost of focus or accessibility.

---

## 1. Dependencies

```bash
npm i framer-motion
```

- `framer-motion` v11+ (layout animations, `AnimatePresence`, drag, `useReducedMotion`).
- No WebGL/three.js in this phase — everything is CSS 3D + framer-motion. (A WebGL upgrade path is noted in §11, Phase 3.)
- Reuse existing `theme.css` tokens; add the motion tokens in §3.

---

## 2. Data contract

The view is a pure projection over the catalog you already index. Define (or adapt to) this shape:

```ts
export type Daw = "ableton" | "flstudio" | "reaper";
export type Genre = "House" | "Techno" | "Hip-Hop" | "Ambient" | "DnB" | "Unknown";

export interface Project {
  id: string;
  name: string;
  daw: Daw;
  genre: Genre;        // from genre.py; fall back to "Unknown"
  bpm: number | null;  // from project parse; null if unknown
  musicalKey: string | null;
  sizeBytes: number;
  modifiedAt: string;  // ISO 8601
  verified: boolean;   // catalog "it opens" state
  path: string;
}
```

Source it from the existing catalog endpoint (adapt the path to your `api.ts`):

```ts
// api.ts
export async function fetchProjects(): Promise<Project[]> {
  const r = await fetch(`${API_BASE}/api/projects`);
  if (!r.ok) throw new Error("projects fetch failed");
  return (await r.json()).projects;
}
```

> If `bpm`/`musicalKey` aren't in the catalog yet, add them to the ALS/FLP/Reaper parsers, or render them as `—`. Everything else (genre, daw, size, modified, verified) already exists.

### Grouping is a client-side `GROUP BY`
No new backend work. The "Crates by" control buckets the same array:

```ts
export type GroupBy = "genre" | "daw" | "tempo" | "recency";
export type CrateSort = "count" | "name" | "recent";

export interface CrateGroup {
  key: string;          // stable id, e.g. "genre:House"
  label: string;        // "House"
  accent: string;       // genre colour, or Sloth Blue for non-genre groups
  projects: Project[];
  count: number;
}
```

---

## 3. Motion tokens (add to the token system)

Add to `tokens.json` (primitives tier) and compile into `tokens.css`. Centralising easing/duration keeps motion consistent and tunable.

```json
{
  "motion": {
    "ease-lazy":  { "$type": "cubicBezier", "$value": [0.2, 0.8, 0.2, 1] },
    "ease-glide": { "$type": "cubicBezier", "$value": [0.16, 1, 0.3, 1] },
    "dur-quick":  { "$type": "duration", "$value": "180ms" },
    "dur-base":   { "$type": "duration", "$value": "320ms" },
    "dur-slow":   { "$type": "duration", "$value": "550ms" },
    "dur-open":   { "$type": "duration", "$value": "600ms" },
    "spin-rpm":   { "$type": "duration", "$value": "7000ms" }
  }
}
```

```ts
// motion.ts — the single source for framer-motion timing
export const EASE_LAZY = [0.2, 0.8, 0.2, 1] as const;   // settle
export const EASE_GLIDE = [0.16, 1, 0.3, 1] as const;   // big moves
export const DUR = { quick: 0.18, base: 0.32, slow: 0.55, open: 0.6 };
export const SPIN_SECONDS = 7;
```

---

## 4. Component architecture

```
screens/Crate/
  CrateView.tsx        // top-level: state machine (shelf ↔ dig), data load
  CrateControls.tsx    // groupBy + crateSort selects, "Dig all", search
  CrateShelf.tsx       // grid of <Crate/>, staggered entrance, FLIP reorder
  Crate.tsx            // one 3D box (faces + record-tops), hover/parallax
  CrateDig.tsx         // the flip view: controls + <VinylStack/> + nav
  VinylStack.tsx       // manages active index, drag, keyboard
  Vinyl.tsx            // one record: tinted disc, printed label, platter spin
  Tonearm.tsx          // (stretch) tonearm that lowers onto active record
  EmptyCrate.tsx       // napping-sloth empty state
  hooks/
    useCrates.ts       // groups + sorts projects -> CrateGroup[]
    useDigList.ts      // filters/sorts a group's projects for the dig
    useKeyboardFlip.ts // ← → Enter Esc
  crate.css            // 3D faces, vinyl, platter — non-animated structure
```

State lives in `CrateView` (or a small `useReducer`):

```ts
interface CrateState {
  level: "shelf" | "dig";
  groupBy: GroupBy;
  crateSort: CrateSort;
  search: string;
  openKey: string | null;     // which crate is open
  digSort: "recent" | "name" | "bpm" | "size";
  verifiedOnly: boolean;
  active: number;             // index in the dig list
}
```

---

## 5. The grouping hook

```ts
// useCrates.ts
import { useMemo } from "react";

const GENRE_COLOR: Record<string, string> = {
  House: "#86B3D3", Techno: "#9DB0C0", "Hip-Hop": "#F5C451",
  Ambient: "#4ADE80", DnB: "#F2706E", Unknown: "#677C8B",
};
const SLOTH_BLUE = "#86B3D3";

function bucket(p: Project, by: GroupBy): { key: string; label: string } {
  switch (by) {
    case "genre": return { key: `genre:${p.genre}`, label: p.genre };
    case "daw":   return { key: `daw:${p.daw}`, label: ({ableton:"Ableton",flstudio:"FL Studio",reaper:"Reaper"})[p.daw] };
    case "tempo": {
      const b = p.bpm ?? 0;
      const label = b <= 90 ? "≤90 BPM" : b <= 120 ? "91–120 BPM" : b <= 140 ? "121–140 BPM" : "140+ BPM";
      return { key: `tempo:${label}`, label };
    }
    case "recency": {
      const days = (Date.now() - +new Date(p.modifiedAt)) / 86400000;
      const label = days <= 7 ? "This week" : days <= 30 ? "This month" : "Older";
      return { key: `recency:${label}`, label };
    }
  }
}

export function useCrates(projects: Project[], by: GroupBy, sort: CrateSort, search: string): CrateGroup[] {
  return useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects;
    const map = new Map<string, CrateGroup>();
    for (const p of filtered) {
      const { key, label } = bucket(p, by);
      if (!map.has(key)) {
        const accent = by === "genre" ? (GENRE_COLOR[p.genre] ?? SLOTH_BLUE) : SLOTH_BLUE;
        map.set(key, { key, label, accent, projects: [], count: 0 });
      }
      const g = map.get(key)!; g.projects.push(p); g.count++;
    }
    const arr = [...map.values()];
    arr.sort((a, b) =>
      sort === "name" ? a.label.localeCompare(b.label)
      : sort === "recent" ? minDays(a) - minDays(b)
      : b.count - a.count);
    return arr;
  }, [projects, by, sort, search]);
}
const minDays = (g: CrateGroup) =>
  Math.min(...g.projects.map(p => (Date.now() - +new Date(p.modifiedAt)) / 86400000));
export { GENRE_COLOR };
```

---

## 6. Animation spec (framer-motion)

Every animation below is transform/opacity only. Wrap the whole feature so reduced-motion users get instant, non-animated states:

```ts
// in CrateView
import { useReducedMotion } from "framer-motion";
const reduce = useReducedMotion();           // pass down via context or props
const t = (d: number) => reduce ? { duration: 0 } : { duration: d, ease: EASE_LAZY };
```

### 6.1 Crate shelf — staggered entrance + FLIP reorder
`CrateShelf` is a `motion` container; each `Crate` has a `layout` prop so that when grouping/sort/search changes, the boxes physically slide to their new positions (FLIP) instead of snapping.

```tsx
const shelf = {
  show: { transition: { staggerChildren: reduce ? 0 : 0.07 } },
};
const crateIn = {
  hidden: { opacity: 0, y: 22 },
  show:   { opacity: 1, y: 0, transition: { duration: reduce ? 0 : DUR.open, ease: EASE_GLIDE } },
};

<motion.div className="shelf" variants={shelf} initial="hidden" animate="show">
  {groups.map(g => (
    <motion.div key={g.key} layout variants={crateIn}>
      <Crate group={g} onOpen={() => open(g.key)} />
    </motion.div>
  ))}
</motion.div>
```

### 6.2 Crate — hover lift + pointer parallax
The box tilts toward the cursor (parallax) and lifts on hover; record-tops nudge up.

```tsx
function Crate({ group, onOpen }: CrateProps) {
  const reduce = useReducedMotion();
  const rx = useMotionValue(-16), ry = useMotionValue(20);
  const onMove = (e: React.PointerEvent) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ry.set(20 + px * 12); rx.set(-16 - py * 8);
  };
  return (
    <motion.button
      className="crate" onPointerMove={onMove}
      onPointerLeave={() => { rx.set(-16); ry.set(20); }}
      whileHover={reduce ? undefined : { y: -9 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: DUR.base, ease: EASE_LAZY }}
      onClick={onOpen} aria-label={`Open ${group.label} crate, ${group.count} records`}
    >
      <motion.div className="box" style={{ rotateX: rx, rotateY: ry, transformPerspective: 760 }}>
        <div className="face f-right" />
        <div className="face f-top">{group.projects.slice(0, 9).map(p =>
          <span key={p.id} className="rtop" style={{ background: GENRE_COLOR[p.genre] }} />)}</div>
        <div className="face f-front">
          <span className="cname">{group.label}</span>
          <CountUp className="ccount" value={group.count} suffix=" records" />
          <span className="cdig">Dig through →</span>
        </div>
      </motion.div>
    </motion.button>
  );
}
```

### 6.3 Shared-element open transition (crate → dig)
Give the opening crate and the dig header the **same `layoutId`** so the crate morphs into the dig view header instead of a hard cut. Wrap levels in `AnimatePresence mode="wait"`.

```tsx
<AnimatePresence mode="wait">
  {level === "shelf"
    ? <motion.div key="shelf" exit={{ opacity: 0 }} transition={t(DUR.base)}><CrateShelf .../></motion.div>
    : <motion.div key="dig" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={t(DUR.base)}><CrateDig .../></motion.div>}
</AnimatePresence>
// In Crate front face AND CrateDig header title, use: layoutId={`crate-${group.key}`}
```

### 6.4 Vinyl cascade (entering the dig)
Records fan out of the crate with a stagger; re-sorting reorders them via `layout`.

```tsx
const stack = { show: { transition: { staggerChildren: reduce ? 0 : 0.045 } } };
const vinylIn = {
  hidden: { opacity: 0, y: 46 },
  show:   { opacity: 1, y: 0, transition: { duration: reduce ? 0 : DUR.slow, ease: EASE_GLIDE } },
};
```

### 6.5 Flip layout (the core interaction)
Each vinyl's resting transform is a function of its offset from `active`. Animate by changing the target — framer tweens it. (Use the persistent-element pattern: render the list, update transforms on `active` change; do **not** remount on flip.)

```tsx
function vinylTransform(offset: number) {
  const ao = Math.abs(offset);
  if (offset < 0) return { rotateX: -72, z: 150, y: 60, opacity: 0, zIndex: 0 };
  if (offset === 0) return { rotateX: -7, z: 50, scale: 1.05, opacity: 1, zIndex: 120 };
  const rx = Math.min(60, 16 + (ao - 1) * 6);
  return { rotateX: rx, z: -ao * 16, scale: 1 - ao * 0.015,
           opacity: ao > 8 ? 0 : ao > 6 ? 0.5 : 1, zIndex: 120 - ao };
}
// <motion.div className="rec" animate={vinylTransform(i - active)}
//   transition={{ duration: DUR.slow, ease: EASE_LAZY }} style={{ transformPerspective: 1150 }}/>
```

### 6.6 Platter spin (turntable) — active record only
Spin the **grooves layer**, keep the label static and upright so it stays readable. Only the active record spins (perf + meaning).

```tsx
<motion.div className="platter"
  animate={reduce ? {} : { rotate: active ? 360 : 0 }}
  transition={active && !reduce ? { duration: SPIN_SECONDS, ease: "linear", repeat: Infinity } : { duration: 0 }}>
  {/* groove rings + a thin seam + edge pip so rotation is visible */}
</motion.div>
{/* label + hole are siblings, not children of .platter, so they don't spin */}
```

### 6.7 Verified pop
On becoming active, the green ✓ does one soft pop.

```tsx
<motion.span className="vbadge"
  initial={false}
  animate={isActive ? { scale: [0, 1.25, 1] } : { scale: 1 }}
  transition={{ duration: reduce ? 0 : DUR.base, ease: EASE_LAZY }}>✓</motion.span>
```

### 6.8 Drag-to-flip with inertia
Use framer drag on the stage; on release, advance by velocity so a hard flick moves several records.

```tsx
<motion.div className="stage" drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.12}
  onDragEnd={(_, info) => {
    const steps = Math.round(-info.offset.x / 90 + -info.velocity.x / 1200);
    setActive(a => clamp(a + steps, 0, list.length - 1));
  }}/>
```

---

## 7. Additional reactive/visual touches (prioritised)

MVP-worthy (cheap, high payoff):
1. **Genre colour wash** — the dig stage background tints to the active record's genre at ~6% opacity, transitioning over `DUR.slow`. Subtle "you're in House" cue.
2. **Count-up numbers** — crate record counts animate from 0 on entrance (`CountUp`), one-shot.
3. **Spine peek on hover** — record-tops rise a few px when a crate is hovered (already prototyped).
4. **Press feedback** — `whileTap={{ scale: 0.98 }}` on crates, nav, chips.
5. **Live search + reshuffle** — typing filters projects; crates that survive animate to new positions via `layout`; matched text highlighted.
6. **Keyboard dig** — `←/→` flip, `Enter` open focused crate, `Esc` back; visible focus ring (Sloth Blue, ≥3:1).

Stretch (more delight, more effort):
7. **Tonearm** — a thin arm lowers onto the active record when it settles (rotate from rest to play angle over `DUR.base`); lifts on flip. Pure decoration; ship behind a flag.
8. **Idle drift** — after ~8s of no input, the active record keeps spinning and the crate "breathes" (1–2px translate loop). Cancel on any input. Honour reduced-motion.
9. **Napping-sloth empty state** — when a crate/filter is empty, show the mascot + "Nothing in this crate yet — point me at a projects folder." (Ties to the brand voice and the empty-state copy in the brand guide.)
10. **Skeleton crates while loading** — flat boxes with an opacity pulse (no gradient shimmer — gradients flash and are off-spec).
11. **Sound-reactive flick** *(optional, only if audio preview exists)* — none by default; do not add audio autoplay.

---

## 8. Interaction & input matrix

| Input | Shelf | Dig |
|---|---|---|
| Click | open crate | pull clicked record to front |
| Drag X | — | flip (with inertia) |
| Wheel / trackpad X | — | flip one per notch (throttle ~80ms) |
| `←` `→` | move focus between crates | flip |
| `Enter` / `Space` | open focused crate | (no-op / open project) |
| `Esc` | — | back to shelf |
| Hover | lift + parallax + peek | — |

---

## 9. Accessibility (required, not optional — this is the "obsessive" half)

- **Reduced motion:** `useReducedMotion()` disables spin, parallax, cascades, idle; transitions become instant. Already threaded through every variant above.
- **Semantics:** shelf is a `listbox`/grid of `option`-like buttons; each crate `<button>` has `aria-label` with label + count. The dig stack exposes the active record's name/BPM/key in an `aria-live="polite"` region (the readout line).
- **Focus:** on `open`, move focus to the dig container/back button; on `back`, return focus to the originating crate (store the trigger ref).
- **Contrast:** all colours come from the token set; borders use `#677C8B`, focus ring uses `blue-300 #99BFDA` (≥3:1 on near-black). No genre colour is used as text on white.
- **Hit targets:** crates and nav buttons ≥44px.
- **Always-available fallback:** the plain list/table view remains the default; Crate view is a toggle. Never the only way to find a project.

---

## 10. Performance

- **Virtualise the dig:** only mount the records within ±10 of `active` (render a window, not 2,000 nodes). The crate "feels" infinite; the DOM stays ~21 nodes.
- **Spin only the active platter** — never animate `rotate` on off-screen records.
- `will-change: transform` on `.rec` and `.box`; avoid animating layout-affecting props (width/top); transforms + opacity only.
- Crates are few (≤~12 groups) so render them all; memoise `useCrates`.
- Debounce search (~120ms) before recompute.
- Cap `staggerChildren` total so large crates don't take seconds to cascade (clamp delay index at ~10).

---

## 11. Phased rollout & acceptance

**Phase 1 — MVP (CSS 3D + framer-motion).** Shelf with grouping/sort/search, crate entrance + hover + parallax, open→dig shared-element morph, vinyl cascade, flip (click/drag/keyboard), platter spin, verified pop, genre wash, reduced-motion, virtualised dig, list view fallback toggle.
**Phase 2 — polish.** Tonearm, idle drift, count-up, skeletons, empty-state sloth, refined inertia.
**Phase 3 — optional WebGL.** Swap `CrateShelf`/`VinylStack` rendering for react-three-fiber for true 3D boxes and grooved discs, keeping the same state/hooks/data contract. Gate on a capability/perf check; keep CSS-3D as fallback.

**Acceptance criteria (Phase 1):**
- [ ] Group by Genre/DAW/Tempo/Recency reshuffles crates with FLIP animation.
- [ ] Sort crates by count/name/recent; sort dig by recent/name/bpm/size.
- [ ] Open a crate → records cascade; flip via click, drag (with inertia), wheel, `←/→`.
- [ ] Active record spins; label stays upright/readable; verified ✓ pops.
- [ ] "Dig all records" enters dig with the full set.
- [ ] `prefers-reduced-motion: reduce` removes spin/parallax/cascade; everything still usable.
- [ ] Keyboard-only and screen-reader navigable; focus returns correctly on back.
- [ ] 60fps with 1,000+ projects (dig virtualised).
- [ ] All colours/borders sourced from tokens; passes the contrast gates from the token spec.

---

## 12. File / PR checklist for the agent
1. Add `motion.*` tokens to `tokens.json`; recompile `tokens.css`.
2. Add `framer-motion`.
3. Create `screens/Crate/*` per §4; `crate.css` for static 3D structure, framer-motion for animation.
4. Wire `fetchProjects()` + `useCrates` + `useDigList`.
5. Add a "Crate view" toggle next to the existing list view (don't replace it).
6. Implement reduced-motion, virtualisation, keyboard + focus management.
7. Tests: `useCrates` grouping/sort (unit), reduced-motion renders static (RTL), keyboard flip (RTL).
8. Manual: verify acceptance checklist; record a short clip for the brand/design review.

> Reuse, don't reinvent: pull genre colours from the token palette, the disc/label/crate structure from the prototype CSS, and the timing from `motion.ts`. The look is already signed off — keep Sloth Blue accents, near-black surfaces, genre-tinted vinyl, and the slow lazy easing.
