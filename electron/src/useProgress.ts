import { useEffect, useState } from "react";
import type { ProgressEvent } from "./types";

export interface ScanProgress {
  active: boolean;
  phase: "searching" | "parsing" | null;
  done: number;
  total: number;
  current: string | null;
  dirs: number;        // folders walked (search phase)
  found: number;       // projects found so far (search phase)
  startedAt: number | null;  // ms epoch when parsing began — for the ETA
}
export interface BackupProgress {
  active: boolean;
  preparing: boolean;
  total: number;
  completed: number;
  skipped: number;
  errors: number;
  current: string | null;
  done: boolean;
  cancelled: boolean;
  mirrorFailed: number;
  log: string[];
  items: BackupItem[];   // one per project this run has reached, in order
}
export interface BackupItem { name: string; state: "working" | "done" | "skipped" | "error"; detail?: string }
export interface LiveProgress {
  scan: ScanProgress;
  backup: BackupProgress;
}

export function initialProgress(): LiveProgress {
  return {
    scan: { active: false, phase: null, done: 0, total: 0, current: null, dirs: 0, found: 0, startedAt: null },
    backup: { active: false, preparing: false, total: 0, completed: 0, skipped: 0, errors: 0, current: null, done: false, cancelled: false, mirrorFailed: 0, log: [], items: [] },
  };
}

// Replace the newest entry for this project (it was "working"), or add it.
function setItem(items: BackupItem[], it: BackupItem): BackupItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].name === it.name && items[i].state === "working") {
      const next = items.slice(); next[i] = it; return next;
    }
  }
  return [...items, it];
}

export function reduceProgress(s: LiveProgress, ev: ProgressEvent): LiveProgress {
  switch (ev.type) {
    case "scan_searching":
      return { ...s, scan: { ...s.scan, active: true, phase: "searching", dirs: ev.dirs, found: ev.found, done: 0, total: 0, current: null } };
    case "scan_start":
      // Parsing begins — stamp the start so the ETA can be derived from the parse rate.
      return { ...s, scan: { ...s.scan, active: true, phase: "parsing", done: 0, total: ev.total, current: null, startedAt: Date.now() } };
    case "scan_progress":
      return { ...s, scan: { ...s.scan, active: true, phase: "parsing", done: ev.done, total: ev.total, current: ev.name } };
    case "scan_done":
      return { ...s, scan: { active: false, phase: null, done: 0, total: 0, current: null, dirs: 0, found: 0, startedAt: null } };
    case "backup_preparing":
      return { ...s, backup: { active: true, preparing: true, total: 0, completed: 0, skipped: 0, errors: 0, current: null, done: false, cancelled: false, mirrorFailed: 0, log: ["Preparing… resolving projects"], items: [] } };
    case "backup_start":
      return {
        ...s,
        backup: { ...s.backup, active: true, preparing: false, total: ev.project_count, completed: 0, skipped: 0, errors: 0, current: null, done: false, cancelled: false, mirrorFailed: 0, log: [`Backing up ${ev.project_count} project(s)…`], items: [] },
      };
    case "project_start":
      return { ...s, backup: { ...s.backup, current: ev.project_name, log: [...s.backup.log, `→ ${ev.project_name}`],
        items: setItem(s.backup.items, { name: ev.project_name, state: "working" }) } };
    case "project_done":
      return {
        ...s,
        backup: {
          ...s.backup, completed: s.backup.completed + 1, current: null,
          log: [...s.backup.log, `✓ ${ev.project_name} — ${ev.file_count} sample(s)${ev.missing_count ? `, ${ev.missing_count} missing` : ""}`],
          items: setItem(s.backup.items, { name: ev.project_name, state: "done",
            detail: `${ev.file_count} sample${ev.file_count === 1 ? "" : "s"}${ev.missing_count ? `, ${ev.missing_count} missing` : ""}` }),
        },
      };
    case "project_skipped":
      return { ...s, backup: { ...s.backup, skipped: s.backup.skipped + 1, current: null, log: [...s.backup.log, `↷ ${ev.project_name} — unchanged, skipped`],
        items: setItem(s.backup.items, { name: ev.project_name, state: "skipped", detail: "Nothing changed since the last backup" }) } };
    case "project_error":
      return { ...s, backup: { ...s.backup, errors: s.backup.errors + 1, current: null, log: [...s.backup.log, `✗ ${ev.project_name}: ${ev.error}`],
        items: setItem(s.backup.items, { name: ev.project_name, state: "error", detail: ev.error }) } };
    case "backup_done": {
      const mf = ev.mirror_failed || 0;
      const log = [...s.backup.log, ev.cancelled
        ? `Cancelled — ${ev.ok_count} backed up, ${ev.skipped_count} unchanged so far.`
        : `Done — ${ev.ok_count} backed up, ${ev.skipped_count} unchanged, ${ev.error_count} error(s).`];
      if (mf > 0) log.push(`⚠ Offsite/cloud mirror failed for ${mf} copy(ies) — your primary backup is safe, but check that destination.`);
      return { ...s, backup: { ...s.backup, active: false, preparing: false, done: true, cancelled: !!ev.cancelled, mirrorFailed: mf, log } };
    }
    default:
      return s;
  }
}

// One persistent socket for the whole app, so no event is ever missed because a
// screen happened to be unmounted, and any screen can read live scan/backup state.
export function useLiveProgress(): LiveProgress {
  const [state, setState] = useState<LiveProgress>(initialProgress);
  useEffect(() => {
    const port = (window as any).ablebackup?.port ?? "8753";
    const token = (window as any).ablebackup?.token ?? "";
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    function connect() {
      ws = new WebSocket(`ws://127.0.0.1:${port}/ws/progress?token=${token}`);
      ws.onopen = () => console.log("[progress] ws open");
      ws.onmessage = (m) => {
        const ev = JSON.parse(m.data) as ProgressEvent;
        console.log("[progress] ev", ev.type, JSON.stringify(ev).slice(0, 80));
        setState((s) => reduceProgress(s, ev));
      };
      ws.onclose = () => { console.log("[progress] ws close (closed=" + closed + ")"); if (!closed) retry = setTimeout(connect, 1000); };
    }
    connect();
    return () => { closed = true; if (retry) clearTimeout(retry); ws?.close(); };
  }, []);
  return state;
}
