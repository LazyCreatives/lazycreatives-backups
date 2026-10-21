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

// Every project a run has dealt with so far: backed up, already safe (skipped) or failed.
// A run of 300 unchanged projects and 3 changed ones moves its bar for all 303.
export const runDoneCount = (b: Pick<BackupProgress, "completed" | "skipped" | "errors">) => b.completed + b.skipped + b.errors;
// How far through the run, 0-100.
export function runPct(b: Pick<BackupProgress, "total" | "completed" | "skipped" | "errors">): number {
  return b.total > 0 ? Math.min(100, Math.round((runDoneCount(b) / b.total) * 100)) : 0;
}
// Home's headline when a run ends. A project whose save time moved but whose contents
// didn't (opened and saved again with no change) is checked, not copied a second time:
// say that, instead of "Backed up and checked 0 projects."
export function runDoneTitle(b: Pick<BackupProgress, "completed" | "skipped" | "errors">): string {
  const n = (k: number) => `${k} ${k === 1 ? "project" : "projects"}`;
  if (b.errors > 0) return `Backed up ${b.completed}, ${b.errors} failed.`;
  if (b.completed === 0 && b.skipped > 0) return `Checked ${n(b.skipped)}. Nothing had changed, so ${b.skipped === 1 ? "it was" : "they were"} already safe.`;
  return `Backed up and checked ${n(b.completed)}.`;
}
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
      return { ...s, backup: { active: true, preparing: true, total: 0, completed: 0, skipped: 0, errors: 0, current: null, done: false, cancelled: false, mirrorFailed: 0, log: ["Getting ready…"], items: [] } };
    case "backup_start":
      return {
        ...s,
        backup: { ...s.backup, active: true, preparing: false, total: ev.project_count, completed: 0, skipped: 0, errors: 0, current: null, done: false, cancelled: false, mirrorFailed: 0, log: [`Backing up ${ev.project_count} ${ev.project_count === 1 ? "project" : "projects"}…`], items: [] },
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
        ? `Stopped. ${ev.ok_count} backed up, ${ev.skipped_count} had nothing new.`
        : `Done. ${ev.ok_count} backed up, ${ev.skipped_count} had nothing new, ${ev.error_count} couldn't be backed up.`];
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
