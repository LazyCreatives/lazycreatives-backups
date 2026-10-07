import { useEffect, useRef, useState } from "react";
import { Nav } from "./components/Nav";
import { Setup } from "./screens/Setup";
import { Home } from "./screens/Home";
import { Sources } from "./screens/Sources";
import { BackupFlow } from "./screens/BackupFlow";
import { Library } from "./screens/Library";
import { Dig } from "./screens/Dig";
import { Plugins } from "./screens/Plugins";
import { Albums } from "./components/Albums";
import { LcBrand } from "./components/LcBrand";
import { FirstBackupModal } from "./components/FirstBackupModal";
import { WhatsNewHost, openWhatsNew } from "./components/WhatsNew";
import { ConfirmHost, ContextMenuHost, DropZone, Exit, ShortcutsPanel, ToastHost, toast, toastWarn } from "./components/Desktop";
import { GenrePickHost } from "./components/GenrePick";
import { CoverPickHost } from "./components/CoverPick";
import { setCoverSource } from "./coverArt";
import { baseName, folderOf, isInside, keep, pageNumber, recall, useDesktopCommands, useEscapeToClose, useFileDrop, useIconProgress, type Dropped } from "./desktop";
import { makeApi, makeCoverSource } from "./api";
import { useLiveProgress } from "./useProgress";
import type { Config, ProjectSummary } from "./types";
import { PlayerBar, togglePlaying } from "./components/Player";
import { EmptyState } from "./components/SlothSpot";
import { useBackForwardInput, useNav, type Place } from "./nav";
import { JUST_BACKED_UP, type LibraryView } from "./libraryFilter";
import { currentTheme, genreColor, getLook, setLook, toggleTheme, useGenreColors } from "./look";
import { PaletteHost, openPalette, type PaletteItem } from "./components/Palette";
import { smartCrates } from "./smart";
import { IS_MAC } from "./desktop";
import { COMPANION_KEYS, openCompanion, useCompanionCommand } from "./companion";
import { NO_FILTERS, type LibFilters } from "./libraryFilter";
import { dawLabel } from "./format";
import { getRecents, openedWhen } from "./recents";
import type { LibraryItem } from "./types";

const api = makeApi();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export type Tab = "home" | "library" | "dig" | "albums" | "plugins" | "settings";
export type FlowStep = "scan" | "review" | "progress";
const TABS: Tab[] = ["home", "library", "dig", "albums", "plugins", "settings"];
const LAST_PAGE = "lc-last-page";

// Project files Backups knows; dropping one adds the folder it sits in. A Logic
// project is a folder that Finder shows as one file, so it counts as a project too.
const PROJECT_FILE = /\.(als|flp|rpp|dawproject|aup3|aup|song|bwproject)$/i;
const PROJECT_PACKAGE = /\.(logicx|logic)\/?$/i;

export interface PendingBackup {
  als_paths: string[];
  names?: string[];   // project names, for the covers on the review screen
  count: number;
  size: number;
  findMissing: boolean;
}

// Set up once there are project folders. Where backups go can stay empty: people
// who only want to browse skip it on the first-run screen ("backups off").
function isConfigured(c: Config): boolean {
  return c.sources.length > 0;
}

export default function App() {
  const [cfg, setCfg] = useState<Config | null | "error">(null);
  useGenreColors();  // a crate colour you pick redraws every screen
  // Where you are: a tab, maybe an open project or crate on it, maybe a backup flow
  // step on top. Kept as a back/forward history (side mouse buttons, Alt+arrows).
  // The app opens on the page it was closed on.
  const nav = useNav<Place & { tab: Tab; flow?: FlowStep | null }>({ tab: recall<Tab>(LAST_PAGE, "home", (v) => TABS.includes(v as Tab)) });
  useBackForwardInput(nav.back, nav.forward);
  const { tab } = nav.place;
  const flow = nav.place.flow ?? null;
  const sub = nav.place.sub ?? null;
  const setTab = (t: Tab, open: string | null = null) => nav.go({ tab: t, sub: open, flow: null });
  // steps inside one backup replace each other, so Back leaves the flow in one press
  const setFlow = (f: FlowStep | null) => f
    ? nav.go({ tab, sub, flow: f }, { replace: !!flow })
    : nav.go({ tab, sub, flow: null });
  // Close an open project/crate: step back if that's where we came from, else go to the list.
  const closeSub = () => {
    const p = nav.prev;
    if (p && p.tab === tab && !p.sub && !p.flow) nav.back(); else setTab(tab);
  };
  const [scanProjects, setScanProjects] = useState<ProjectSummary[] | null>(null);
  const [pending, setPending] = useState<PendingBackup | null>(null);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [showFirstBackup, setShowFirstBackup] = useState(false);
  const live = useLiveProgress();
  const [showKeys, setShowKeys] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);  // bumped to reload Settings after a drop
  const [scanLibraryNow, setScanLibraryNow] = useState(false);  // first run with backups skipped
  // Open the Library on a given view. The view is passed along separately because
  // going to the Library while already on it changes no page, and must still show it.
  const [libraryView, setLibraryView] = useState<LibraryView | null>(null);
  const openLibrary = (view: LibraryView) => { setLibraryView(view); setTab("library"); };
  useEffect(() => { keep(LAST_PAGE, tab); }, [tab]);

  // Cmd/Ctrl+K: every page, action, smart crate, genre and project in one list.
  const paletteProjects = useRef<LibraryItem[]>([]);
  const showPalette = () => {
    api.library().then((r) => { paletteProjects.current = r.projects; }).catch(() => {}).finally(openPalette);
  };
  const paletteItems = (): PaletteItem[] => {
    const mod = IS_MAC ? "Cmd" : "Ctrl";
    const pages: [Tab, string, PaletteItem["icon"]][] = [["home", "Home", "home"], ["library", "Library", "library"], ["dig", "Dig", "dig"], ["albums", "Albums", "music"], ["plugins", "Plugins", "plug"], ["settings", "Settings", "settings"]];
    const list = paletteProjects.current;
    const genres = [...new Set(list.map((i) => i.genre || "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const other = getLook() === "crate" ? "sleeve" : "crate";
    return [
      // the last few opened, ready before anything is typed
      ...getRecents().slice(0, 4).map((r) => ({ id: `recent-${r.id}`, group: "Recently opened", label: r.name, cover: { name: r.cover, genre: r.genre },
        hint: openedWhen(r.at).replace(/^o/, "O"), idle: true,
        run: () => setTab("library", r.id) })),
      ...pages.map(([t, label, icon], i) => ({ id: `go-${t}`, group: "Go to", label, icon, keys: `${mod} + ${i + 1}`, run: () => setTab(t) })),
      { id: "backup", group: "Actions", label: "Back up now", icon: "refresh", words: ["scan", "save"], run: () => setFlow("scan") },
      { id: "look", group: "Actions", label: `Switch to the ${other === "sleeve" ? "Sleeve" : "Crate"} look`, icon: "palette", words: ["look", "theme", "crate", "sleeve"], run: () => setLook(other) },
      { id: "theme", group: "Actions", label: `Switch to ${currentTheme() === "light" ? "dark" : "light"}`, icon: "palette", words: ["theme", "light", "dark", "mode"], run: toggleTheme },
      { id: "companion", group: "Actions", label: "Open the narrow window", icon: "narrow", keys: COMPANION_KEYS,
        words: ["companion", "small", "side", "beside", "float", "on top", "mini"], run: openCompanion },
      { id: "play", group: "Actions", label: "Play or pause", icon: "play", keys: "Space", run: togglePlaying },
      { id: "new", group: "Actions", label: "What's new", icon: "info", run: openWhatsNew },
      { id: "keys", group: "Actions", label: "Keyboard shortcuts", icon: "command", words: ["keys", "help"], run: () => setShowKeys(true) },
      ...smartCrates<LibFilters>("library").map((c) => {
        const f = { ...NO_FILTERS, ...c.filters };
        return { id: `smart-${c.id}`, group: "Smart crates", label: c.name, icon: "crate" as const, run: () => openLibrary({ status: f.status, filters: f }) };
      }),
      ...genres.map((g) => ({ id: `genre-${g}`, group: "Genres", label: g, colour: genreColor(g), quiet: true,
        hint: plural(list.filter((i) => i.genre === g).length, "project"), run: () => openLibrary({ status: "all", filters: { genre: g } }) })),
      ...list.map((it) => ({ id: `p-${it.project_id}`, group: "Projects", label: it.name, cover: { name: it.name, genre: it.genre }, quiet: true,
        hint: [it.genre, it.bpm ? `${Math.round(it.bpm)} BPM` : "", dawLabel(it.daw)].filter(Boolean).join(" · "),
        words: [it.genre || "", it.latest_export?.name || ""], run: () => setTab("library", it.project_id) })),
    ];
  };

  // Keyboard shortcuts and the menu bar (see desktop.ts).
  useDesktopCommands((cmd) => {
    if (cmd === "settings") setTab("settings");
    else if (cmd === "back") nav.back();
    else if (cmd === "forward") nav.forward();
    else if (cmd === "play") togglePlaying();
    else if (cmd === "whats-new") openWhatsNew();
    else if (cmd === "shortcuts") setShowKeys(true);
    else if (cmd === "palette") showPalette();
    else {
      const n = pageNumber(cmd);
      if (n && TABS[n - 1]) setTab(TABS[n - 1]);
    }
  });
  // The narrow window hands over to this one: "Open Backups", or a project in it.
  useCompanionCommand((cmd) => {
    if (cmd.go === "project") setTab("library", cmd.name);
    else setTab("home");
  });
  // Escape closes an open project or crate.
  useEscapeToClose(sub && !flow ? closeSub : null);

  // How far a backup (or the reading part of a scan) has got, on the dock / taskbar icon.
  const b = live.backup, sc = live.scan;
  useIconProgress(
    b.active ? (b.total ? (b.completed + b.skipped + b.errors) / b.total : 0)
      : sc.active && sc.phase === "parsing" && sc.total ? sc.done / sc.total
      : null,
  );

  // Drop a folder (or a project file) on the window to add it to the folders Backups looks in.
  async function addDropped(items: Dropped[]) {
    if (!cfg || cfg === "error") return;
    const folders = [...new Set(items.flatMap((d) =>
      d.kind === "folder" && PROJECT_PACKAGE.test(d.path) ? [folderOf(d.path.replace(/[\\/]+$/, ""))]
        : d.kind === "folder" ? [d.path] : d.kind === "file" && PROJECT_FILE.test(d.path) ? [folderOf(d.path)] : []))];
    if (!folders.length) { toast("Drop a project folder (or a project file) to add it."); return; }
    const fresh = folders.filter((f) => !isInside(f, cfg.sources));
    if (!fresh.length) {
      toast(folders.length === 1 ? `Backups already looks in ${baseName(folders[0])}.` : "Backups already looks in those folders.");
      return;
    }
    try {
      const saved = await api.saveSettings({ ...cfg, sources: [...cfg.sources, ...fresh] });
      setCfg(saved);
      setSettingsKey((k) => k + 1);
      toast(fresh.length === 1 ? `Added ${baseName(fresh[0])} to your project folders.` : `Added ${fresh.length} project folders.`,
        { label: "Scan now", onClick: () => setFlow("scan") });
    } catch {
      toastWarn("Couldn't add that folder. Try Add folder in Settings.");
    }
  }
  const dragging = useFileDrop(addDropped, !!cfg && cfg !== "error" && isConfigured(cfg));

  // Was the app already set up when it opened? Only then can "What's new" show
  // on a first run of this version (a fresh install has nothing new to show).
  const setUpAtOpen = useRef<boolean | null>(null);
  useEffect(() => {
    api.getSettings().then((c) => {
      if (setUpAtOpen.current === null) setUpAtOpen.current = isConfigured(c);
      setCfg(c);
    }).catch(() => setCfg("error"));
  }, []);

  // Your cover pictures, so every cover on every page can draw with them.
  useEffect(() => { setCoverSource(makeCoverSource()); }, []);

  // Notification permission, once.
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // One OS notification when a backup finishes, from anywhere.
  const prevDone = useRef(false);
  useEffect(() => {
    if (live.backup.done && !prevDone.current && "Notification" in window && Notification.permission === "granted") {
      new Notification("LazyCreatives Backups", {
        body: live.backup.cancelled
          ? `Backup cancelled — ${live.backup.completed} done.`
          : `Backup finished — ${live.backup.completed} ok, ${live.backup.errors} error(s).`,
      });
    }
    // One-time onboarding: explain the payoff after the very first successful backup.
    if (live.backup.done && !prevDone.current && !live.backup.cancelled
        && live.backup.completed > 0 && !localStorage.getItem("lc_onboarded")) {
      localStorage.setItem("lc_onboarded", "1");
      setShowFirstBackup(true);
    }
    prevDone.current = live.backup.done;
  }, [live.backup.done, live.backup.completed, live.backup.errors, live.backup.cancelled]);

  // One-click backup: start straight from Scan with smart defaults (opens-anywhere
  // + gather-missing), skipping the Review step. Falls back to Review on error.
  async function launchBackup(p: PendingBackup) {
    try {
      const { job_id } = await api.startBackup({
        als_paths: p.als_paths, find_missing: p.findMissing,
        portable: true, layout: "project_date",
      });
      setActiveJob(job_id);
      setFlow("progress");
    } catch {
      setPending(p);
      setFlow("review");
    }
  }

  if (cfg === null) return (
    <div className="splash">
      <div style={{ display: "grid", placeItems: "center", gap: 14 }}>
        <LcBrand app="Backups" tag="Starting…" busy />
      </div>
    </div>
  );
  if (cfg === "error") {
    return (
      <div className="splash">
        <EmptyState pose="tangled" title="Backups couldn't start its engine"
          action={<button className="btn btn--primary" onClick={() => (window as any).ablebackup?.relaunch?.()}>Restart the app</button>}>
          The part of the app that does the backing up didn't answer. Restarting the app usually fixes it; your backups are safe. If it keeps happening, use Help, Report a problem.
        </EmptyState>
      </div>
    );
  }
  if (!isConfigured(cfg)) {
    return <Setup onDone={(c, skipped) => {
      setCfg(c);
      // Skipped backups: straight to the Library, finding projects to browse.
      if (skipped) { setScanLibraryNow(true); nav.go({ tab: "library" }, { replace: true }); }
      else nav.go({ tab: "home", flow: "scan" }, { replace: true });
    }} />;
  }

  const busy = live.scan.active || live.backup.active;

  return (
    <div className="app">
      <Nav tab={tab} flowActive={!!flow} busy={busy}
        onNavigate={(t) => setTab(t)}
        onOpenRecent={(id) => setTab("library", id)} openId={tab === "library" && !flow ? sub : null} />
      <main className="main">
        <div className="content">
          <div key={flow ?? (tab === "settings" ? `settings-${settingsKey}` : tab)} className="view-enter">
          {flow ? (
            <BackupFlow
              step={flow}
              projects={scanProjects}
              onProjects={setScanProjects}
              scan={live.scan}
              backup={live.backup}
              pending={pending}
              activeJob={activeJob}
              onBackup={launchBackup}
              onReview={(p) => { setPending(p); setFlow("review"); }}
              onStarted={(jobId) => { setActiveJob(jobId); setFlow("progress"); }}
              onBackToScan={() => setFlow("scan")}
              onExit={() => setTab("home")}
            />
          ) : tab === "home" ? (
            <Home
              backup={live.backup}
              onBackupNow={() => setFlow("scan")}
              onOpenSettings={() => setTab("settings")}
              onResumeProgress={() => setFlow("progress")}
              onOpenHistory={() => setTab("library")}
              onOpenStatus={(status) => openLibrary({ status })}
              onOpenFilters={(filters) => openLibrary({ status: "all", filters })}
              onOpenProject={(name) => setTab("library", name)}
            />
          ) : tab === "library" ? (
            <Library scan={live.scan} openProject={sub}
              scanOnOpen={scanLibraryNow} onScanStarted={() => setScanLibraryNow(false)}
              show={libraryView} onShown={() => setLibraryView(null)}
              onOpen={(id) => setTab("library", id)} onClose={closeSub} />
          ) : tab === "dig" ? (
            <Dig openCrate={sub} onOpenCrate={(key) => setTab("dig", key)} onCloseCrate={closeSub}
              onOpenProject={(name) => setTab("library", name)} />
          ) : tab === "albums" ? (
            <Albums app="backups" open={sub} onOpen={(id) => setTab("albums", id)} onClose={() => setTab("albums")}
              metaFor={(s, a, i) => ({ title: s.title, project: s.project || undefined, projectId: s.project_id ?? undefined,
                sub: `${a.title} · ${i + 1} of ${a.songs.length}` })}
              onOpenProject={(s) => { if (s.project_id) setTab("library", s.project_id); }} />
          ) : tab === "plugins" ? (
            <Plugins onOpenProject={(name) => setTab("library", name)} />
          ) : (
            <Sources />
          )}
          </div>
        </div>
      </main>
      <PlayerBar onOpenProject={(key) => setTab("library", key)} />
      <WhatsNewHost setUp={setUpAtOpen.current === true} />
      <ContextMenuHost />
      <ToastHost />
      <ConfirmHost />
      <GenrePickHost />
      <CoverPickHost />
      <PaletteHost items={paletteItems} />
      <DropZone show={dragging} title="Drop to add" hint="Drop a project folder to add it to the folders Backups looks in." />
      {showKeys && <ShortcutsPanel onClose={() => setShowKeys(false)} />}
      <Exit>{showFirstBackup && (
        <FirstBackupModal
          completed={live.backup.completed}
          onHistory={() => { setShowFirstBackup(false); openLibrary(JUST_BACKED_UP); }}
          onClose={() => setShowFirstBackup(false)}
        />
      )}</Exit>
    </div>
  );
}
