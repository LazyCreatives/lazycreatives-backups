import { useEffect, useMemo, useRef, useState } from "react";
import { makeApi } from "../api";
import type { Overview, LibraryItem } from "../types";
import type { BackupProgress } from "../useProgress";
import { CountUp } from "../components/CountUp";
import { WaveBackdrop, useSpecular, reduceMotion } from "../components/Glass";
import { fmtSize, fmtDate, fmtInterval, fmtClock, shortPath } from "../format";
import slothUrl from "../assets/lazy-creatives-sloth.png";
import "../home.css";

const api = makeApi();

/* ── project cloud: dependency-free circle packing over REAL library data ── */
interface Bubble { name: string; mb: number; r: number; x: number; y: number;
  warn: boolean; missing: number; verified: boolean; }

function layoutBubbles(items: LibraryItem[], W: number, H: number): Bubble[] {
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const data: Bubble[] = items.map((it) => ({
    name: it.name,
    mb: Math.max(1, Math.round(it.size / 1e6)),
    r: 0, x: 0, y: 0,
    warn: it.missing_count > 0,
    missing: it.missing_count,
    verified: it.backed_up,
  }));
  // bubble AREA ∝ MB on disk. Density is auto-fit BOTH ways: scaled down past 42%
  // (overlap impossible) and up below 24% (the cloud fills big panels instead of
  // floating as specks); relative sizes stay truthful either way.
  data.forEach((d) => { d.r = 5 + Math.sqrt(d.mb) * 0.78; });
  const PAD = 9;
  const area = data.reduce((s, d) => s + Math.PI * (d.r + PAD / 2) ** 2, 0);
  const density = area / (W * H);
  if (density > 0.42) { const k = Math.sqrt(0.42 / density); data.forEach((d) => { d.r *= k; }); }
  else if (density > 0 && density < 0.32) {
    const k = Math.sqrt(0.32 / density);
    const rCap = H * 0.38;  // no single bubble dominates the panel
    data.forEach((d) => { d.r = Math.min(d.r * k, rCap); });
  }
  data.forEach((d) => { d.x = d.r + rnd() * (W - 2 * d.r); d.y = d.r + rnd() * (H - 2 * d.r); });
  const cx = W / 2, cy = H / 2;
  for (let iter = 0; iter < 260; iter++) {
    let moved = false;
    // gentle gravity toward the centre (first 200 iters) so the cloud reads as ONE
    // cluster, not scatter; the tail iterations are pure separation so nothing
    // is left overlapping when the loop settles.
    if (iter < 200) for (const d of data) { d.x += (cx - d.x) * 0.012; d.y += (cy - d.y) * 0.012; }
    for (let i = 0; i < data.length; i++) for (let j = i + 1; j < data.length; j++) {
      const a = data[i], b = data[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      const min = a.r + b.r + PAD;
      if (d < min) {
        moved = true;
        let nx, ny;
        if (d < 0.01) { const ang = rnd() * Math.PI * 2; nx = Math.cos(ang); ny = Math.sin(ang); d = 0.01; }
        else { nx = dx / d; ny = dy / d; }
        const push = (min - d) / 2 + 0.5;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
    for (const d of data) {
      d.x = Math.min(W - d.r - 2, Math.max(d.r + 2, d.x));
      d.y = Math.min(H - d.r - 2, Math.max(d.r + 2, d.y));
    }
    if (!moved && iter >= 200) break;  // only settle once gravity has finished
  }
  return data;
}

function ProjectCloud({ items, onPick, onToggleDrawer }: {
  items: LibraryItem[]; onPick: (name: string) => void; onToggleDrawer: () => void;
}) {
  // measure the real container so the cloud lays out 1:1 at any window size
  const [dims, setDims] = useState({ w: 1060, h: 320 });
  const tipRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gRefs = useRef<(SVGGElement | null)[]>([]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.max(520, Math.floor(entries[0].contentRect.width));
      setDims((d) => (d.w === w ? d : { w, h: Math.round(Math.min(Math.max(280, w * 0.30), 460)) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const bubbles = useMemo(() => layoutBubbles(items, dims.w, dims.h), [items, dims]);

  // one rAF loop bobs every bubble (amplitude < half the packing gap)
  useEffect(() => {
    if (reduceMotion() || bubbles.length === 0) return;
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const motion = bubbles.map(() => ({ amp: 1 + rnd() * 1.5, sp: 3000 + rnd() * 4000, ph: rnd() * Math.PI * 2 }));
    let raf = 0;
    const tick = (t: number) => {
      gRefs.current.forEach((g, i) => {
        if (!g) return;
        const b = bubbles[i], m = motion[i];
        g.setAttribute("transform", `translate(${b.x},${b.y + Math.sin((t / m.sp) * 2 * Math.PI + m.ph) * m.amp})`);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bubbles]);

  const showTip = (e: React.MouseEvent, b: Bubble) => {
    const tip = tipRef.current, wrap = wrapRef.current; if (!tip || !wrap) return;
    const cls = b.warn ? "warn" : b.verified ? "ok" : "idle";
    tip.className = `cloud-tip cloud-tip--${cls}`;
    tip.style.opacity = "1";
    const size = b.mb >= 1000 ? (b.mb / 1000).toFixed(1) + " GB" : b.mb + " MB";
    tip.innerHTML = `<div class="t-name"></div><div class="t-meta">${size} on disk · <span class="t-state">${
      b.warn ? `⚠ ${b.missing} sample${b.missing > 1 ? "s" : ""} missing`
      : b.verified ? "✓ verified — it opens" : "not backed up yet"}</span></div>`;
    (tip.querySelector(".t-name") as HTMLElement).textContent = b.name;
    // coords relative to the cloud wrapper (fixed positioning breaks inside
    // backdrop-filtered ancestors); flip to the cursor's left near the right edge
    const r = wrap.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const fitsRight = cx + 16 + tip.offsetWidth <= r.width - 4;
    tip.style.left = (fitsRight ? cx + 16 : cx - tip.offsetWidth - 16) + "px";
    tip.style.top = e.clientY - r.top - 14 + "px";
  };
  const hideTip = () => { if (tipRef.current) tipRef.current.style.opacity = "0"; };

  return (
    <div className="cloud-wrap" ref={wrapRef}>
      <svg className="cloud" viewBox={`0 0 ${dims.w} ${dims.h}`} style={{ height: dims.h }}
        role="group" aria-label="Project cloud — one bubble per project, sized by folder size">
        {/* glassy orb fills — off-centre highlight, same material language as the panels */}
        <defs>
          <radialGradient id="orbOk" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="rgba(74,222,128,0.50)" />
            <stop offset="55%" stopColor="rgba(74,222,128,0.20)" />
            <stop offset="100%" stopColor="rgba(74,222,128,0.10)" />
          </radialGradient>
          <radialGradient id="orbIdle" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="rgba(157,176,192,0.34)" />
            <stop offset="55%" stopColor="rgba(134,179,211,0.12)" />
            <stop offset="100%" stopColor="rgba(59,79,93,0.10)" />
          </radialGradient>
          <radialGradient id="orbWarn" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="rgba(245,196,81,0.55)" />
            <stop offset="55%" stopColor="rgba(245,196,81,0.22)" />
            <stop offset="100%" stopColor="rgba(245,196,81,0.12)" />
          </radialGradient>
        </defs>
        {bubbles.map((b, i) => (
          <g key={b.name + i} ref={(el) => { gRefs.current[i] = el; }}
            className={`bubble${b.warn ? " bubble--warn" : b.verified ? "" : " bubble--idle"}`}
            transform={`translate(${b.x},${b.y})`}
            tabIndex={0} role="button"
            aria-label={b.name + (b.warn ? `, needs a look, ${b.missing} missing` : b.verified ? ", verified" : ", not backed up")}
            onMouseMove={(e) => showTip(e, b)}
            onMouseLeave={hideTip}
            onClick={() => (b.warn ? onToggleDrawer() : onPick(b.name))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.warn ? onToggleDrawer() : onPick(b.name); }
            }}>
            <circle r={b.r} />
            {b.r > 26 && (
              <text dy="0.35em">
                {b.name.length > Math.floor(b.r / 4.2) ? b.name.slice(0, Math.floor(b.r / 4.2)) + "…" : b.name}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="cloud-tip" ref={tipRef} />
    </div>
  );
}

/* ── Home ── */
export function Home({ backup, onBackupNow, onOpenSettings, onResumeProgress, onOpenHistory, onOpenProject }: {
  backup: BackupProgress;
  onBackupNow: () => void;
  onOpenSettings: () => void;
  onResumeProgress: () => void;
  onOpenHistory: () => void;
  onOpenProject: (name: string) => void;
}) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [err, setErr] = useState(false);
  const [kick, setKick] = useState(false);        // scanning before the backup starts
  const [doneFlash, setDoneFlash] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [fixing, setFixing] = useState<Set<string>>(new Set());
  const heroRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = () => {
    api.overview().then(setOv).catch(() => setErr(true));
    api.library().then((r) => setItems(r.projects)).catch(() => {});
  };
  useEffect(load, [backup.done]);
  useEffect(() => {  // pool size is computed in the background the first time
    if (ov && !ov.pool_known) {
      const t = setTimeout(() => api.overview().then(setOv).catch(() => {}), 3000);
      return () => clearTimeout(t);
    }
  }, [ov]);

  // backup run state machine: idle → working → done (5.2s) → idle
  const working = kick || backup.active;
  const prevActive = useRef(false);
  useEffect(() => {
    if (prevActive.current && !backup.active && backup.done && !backup.cancelled) {
      setDoneFlash(true);
      // success ✓ particles
      if (!reduceMotion() && heroRef.current) {
        for (let i = 0; i < 7; i++) {
          const c = document.createElement("span");
          c.className = "hero-pop"; c.textContent = "✓";
          c.style.left = 30 + Math.random() * 55 + "%";
          c.style.top = 35 + Math.random() * 40 + "%";
          c.style.animationDelay = i * 0.12 + "s";
          heroRef.current.appendChild(c);
          setTimeout(() => c.remove(), 1800 + i * 120);
        }
      }
      const t = setTimeout(() => setDoneFlash(false), 5200);
      return () => clearTimeout(t);
    }
    prevActive.current = backup.active;
  }, [backup.active, backup.done, backup.cancelled]);

  // pointer-tracked specular highlight on every glass panel
  useSpecular(rootRef);

  // the ONE primary action: scan + back everything up, in place, with real progress
  async function backItUp() {
    if (working) return;
    setKick(true);
    try {
      const r = await api.scanMac("sources", true);
      const paths = r.projects.map((p) => p.als_path);
      if (paths.length === 0) { onBackupNow(); return; }  // nothing found → guided flow
      await api.startBackup({ als_paths: paths, find_missing: true, portable: true, layout: "project_date" });
    } catch {
      onBackupNow();  // quick path failed → fall back to the guided flow
    } finally {
      setKick(false);
    }
  }

  // "Find it for me": re-back up that one project with sample-hunting on. An
  // optional extraLib is a folder the user pointed at ("look in this folder"),
  // searched this run in addition to the saved sample libraries.
  async function fixOne(it: LibraryItem, extraLib?: string) {
    setFixing((s) => new Set(s).add(it.project_id));
    try {
      const { job_id } = await api.startBackup({
        als_paths: [it.path], find_missing: true, portable: true, layout: "project_date",
        libraries: extraLib ? [extraLib] : undefined,
      });
      for (;;) {
        const st = await api.jobStatus(job_id);
        if (st.state === "done" || st.state === "error") break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch { /* result shows on reload */ }
    finally {
      setFixing((s) => { const n = new Set(s); n.delete(it.project_id); return n; });
      load();
    }
  }

  // "Look in a folder": pick a folder you think the samples are in, then hunt there.
  async function lookInFolder(it: LibraryItem) {
    const dir = await (window as any).ablebackup?.pickFolder?.();
    if (dir) fixOne(it, dir);
  }

  if (err) return <div className="card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>Couldn't reach the backup service.</div>;
  if (!ov) return <p className="sub">Waking the sloth…</p>;

  const verified = items.filter((i) => i.backed_up).length;
  const waiting = items.length - verified;
  const warnItems = items.filter((i) => i.missing_count > 0);
  const savedPct = ov.logical_size > 0 ? Math.round((ov.saved_bytes / ov.logical_size) * 100) : 0;
  const driveTotal = ov.actual_size + ov.nas.free_bytes;
  const driveFrac = driveTotal > 0 ? ov.actual_size / driveTotal : 0;
  const ringPct = backup.total > 0 ? backup.completed / backup.total : (working ? 0.06 : 0);

  // §8 voice: chill tone, precise facts — numbers are real, never vague
  // Don't claim "all good" when some projects are missing samples or the run had errors.
  const doneClean = backup.errors === 0 && warnItems.length === 0;
  const title = doneFlash
    ? (backup.errors > 0 ? "Backed up, with errors." : doneClean ? "Backed up & verified." : "Backed up.")
    : working ? "On it." : "Chilling.";
  const sub = doneFlash
    ? `${backup.completed} project${backup.completed === 1 ? "" : "s"}, ${backup.errors} error${backup.errors === 1 ? "" : "s"} — every file re-read and proven to open.${
        warnItems.length > 0
          ? ` ${warnItems.length} project${warnItems.length === 1 ? " is" : "s are"} missing samples and could use a look.`
          : backup.errors === 0 ? " Go make something." : ""}`
    : working
    ? "Reading every file, hashing it, and proving the copy opens. You don't have to watch — but it is pretty satisfying."
    : items.length === 0
    ? "Nothing in the library yet. Hit the button and I'll go find your projects."
    : `${verified} project${verified === 1 ? "" : "s"} tucked in, re-read and proven to open.${
        warnItems.length > 0 ? ` ${warnItems.length} could use a look — otherwise, go make something.` : " Go make something."}`;
  const status = doneFlash
    ? `✓ snapshot verified · ${backup.completed} project${backup.completed === 1 ? "" : "s"} · just now`
    : working
    ? `⟳ ${kick && !backup.active ? "finding projects…" : `backing up ${backup.current || "…"} · ${backup.completed}/${backup.total} projects`}`
    : ov.last_run
    ? `✓ last run ${fmtDate(ov.last_run)}${ov.attention.length > 0 ? ` · ${ov.attention.length} need${ov.attention.length === 1 ? "s" : ""} attention` : ""}`
    : "no runs yet";

  return (
    <div className="home" ref={rootRef}>
      <WaveBackdrop energized={working} />

      {/* hero — the sloth is the status */}
      <section ref={heroRef} className={`hero glass elev-1${working ? " hero--working" : ""}${doneFlash ? " hero--done" : ""}${doneFlash && !doneClean ? " hero--done-warn" : ""}`}>
        <div className="sloth-stage"><img src={slothUrl} alt="" /></div>
        <div className="hero-copy">
          <h1 className="hero-title">{title}</h1>
          <p className="hero-sub">{sub}</p>
          <span className="hero-status mono">{status}{" "}
            {working && backup.active && (
              <button className="linkbtn" style={{ fontSize: 12.5 }} onClick={onResumeProgress}>watch the details →</button>
            )}
          </span>
        </div>
        <div className="hero-cta">
          <div className="ringwrap">
            <svg viewBox="0 0 148 148" aria-hidden="true">
              <circle className="ring-bg" cx="74" cy="74" r="70" />
              <circle className="ring-fg" cx="74" cy="74" r="70"
                style={{ strokeDashoffset: doneFlash ? 0 : 440 - 440 * ringPct }} />
            </svg>
            <button className="bigbtn" onClick={backItUp} disabled={working || !ov.nas.reachable}
              title={ov.nas.reachable ? "Scan + back up everything, verified" : "Connect a destination in Settings first"}>
              {doneFlash ? "✓ done" : working ? "on it" : <>Back<br />it up</>}
            </button>
          </div>
          <span className="schedule-hint">or <button onClick={onOpenSettings}>set a schedule</button> &amp; forget it</span>
        </div>
      </section>

      {/* project cloud */}
      {items.length > 0 && (
        <section className="wall glass">
          <div className="wall-head">
            <h2>Your projects, floating happily</h2>
            <div className="wall-legend">
              <span><span className="swatch sw-ok" />verified — it opens</span>
              {waiting > 0 && <span><span className="swatch sw-idle" />not backed up</span>}
              {warnItems.length > 0 && <span><span className="swatch sw-warn" />needs a look</span>}
              <span className="mono">{verified} verified · {waiting} waiting · sized by folder size on disk</span>
              <button className="linkbtn" style={{ fontSize: 12.5 }} onClick={onOpenHistory}>browse the library →</button>
            </div>
          </div>
          <ProjectCloud items={items} onPick={onOpenProject} onToggleDrawer={() => setDrawer((d) => !d)} />
          <div className={`attn-drawer${drawer ? " attn-drawer--open" : ""}`}>
            {warnItems.map((it) => (
              <div key={it.project_id} className="attn-item">
                <div className="what">
                  <strong>{it.name}</strong>{" "}
                  <span>— {it.missing_count} sample{it.missing_count === 1 ? "" : "s"} missing</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button className="fixbtn" onClick={() => fixOne(it)} disabled={fixing.has(it.project_id)}>
                    {fixing.has(it.project_id) ? "Hunting…" : it.missing_count === 1 ? "Find it for me" : "Find them for me"}
                  </button>
                  <button className="fixbtn" onClick={() => lookInFolder(it)} disabled={fixing.has(it.project_id)}
                    title="Pick a folder you think these samples are in, and search there">
                    Look in a folder…
                  </button>
                  <button className="fixbtn" onClick={() => onOpenProject(it.name)}>Open →</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* stats */}
      <div className="home-row">
        <section className="home-panel glass elev-3 hpanel">
          <h2>Space saved</h2>
          <div className="squeeze">
            <div className="tube">
              <span className="ghostlabel mono">{fmtSize(ov.logical_size)} if copied in full</span>
              <div className="stored mono" style={{ width: ov.pool_known && ov.logical_size > 0 ? `${Math.max(8, Math.round((ov.actual_size / ov.logical_size) * 100))}%` : "0%" }}>
                {ov.pool_known ? `${fmtSize(ov.actual_size)} stored` : "…"}
              </div>
            </div>
            <div className="nums">
              <div className="big">{ov.pool_known ? <CountUp value={ov.saved_bytes} format={fmtSize} /> : "…"}</div>
              <div className="sm">saved{savedPct > 0 ? ` · ${savedPct}% smaller` : ""}</div>
            </div>
          </div>
        </section>
        <section className="home-panel glass elev-3 hpanel">
          <h2>On your drive</h2>
          <div className="drive">
            <svg className="donut" viewBox="0 0 92 92" aria-hidden="true">
              <circle className="track" cx="46" cy="46" r="36" />
              {/* honest arc: true fraction, round cap — tiny usage reads as a dot, never inflated */}
              <circle className="val" cx="46" cy="46" r="36" transform="rotate(-90 46 46)"
                style={{ strokeDashoffset: 226 - 226 * Math.min(1, driveFrac) }} />
            </svg>
            <div className="txt">
              <div className="big">{ov.pool_known ? fmtSize(ov.actual_size) : "…"}</div>
              <div className="sm">of your drive · {fmtSize(ov.nas.free_bytes)} free</div>
              <span className="mono" style={{ fontSize: 12 }}>
                {driveFrac < 0.5 ? "plenty of room. keep making." : driveFrac < 0.85 ? "getting cosy in here." : "drive's filling up — worth a look."}
              </span>
            </div>
          </div>
        </section>
      </div>

      <div className="home-statusbar">
        <span title={ov.nas.path}>
          <span className={`gdot${ov.nas.reachable ? "" : " gdot--off"}`} />
          {ov.nas.reachable ? "NAS connected" : "NAS offline"}{ov.nas.path ? ` · ${shortPath(ov.nas.path)}` : ""}
        </span>
        <span className="mono" style={{ fontSize: 12.5 }}>
          {ov.schedule.enabled
            ? `Auto-backup ${fmtInterval(ov.schedule.interval_minutes)}${ov.schedule.next_run ? ` · next ${fmtClock(ov.schedule.next_run)}` : ""}`
            : <>Auto-backup off — runs when you say so. <button onClick={onOpenSettings}>Set a schedule</button></>}
        </span>
      </div>
    </div>
  );
}
