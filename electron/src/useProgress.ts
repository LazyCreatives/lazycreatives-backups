import { useEffect, useState } from "react";
import type { ProgressEvent } from "./types";

export interface ScanProgress {
  active: boolean;
  done: number;
  total: number;
  current: string | null;
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
  log: string[];
}
export interface LiveProgress {
  scan: ScanProgress;
  backup: BackupProgress;
}

export function initialProgress(): LiveProgress {
  return {
    scan: { active: false, done: 0, total: 0, current: null },
    backup: { active: false, preparing: false, total: 0, completed: 0, skipped: 0, errors: 0, current: null, done: false, log: [] },
  };
}

export function reduceProgress(s: LiveProgress, ev: ProgressEvent): LiveProgress {
  switch (ev.type) {
    case "scan_start":
      return { ...s, scan: { active: true, done: 0, total: ev.total, current: null } };
    case "scan_progress":
      return { ...s, scan: { active: true, done: ev.done, total: ev.total, current: ev.name } };
    case "scan_done":
      return { ...s, scan: { active: false, done: 0, total: 0, current: null } };
    case "backup_preparing":
      return { ...s, backup: { active: true, preparing: true, total: 0, completed: 0, skipped: 0, errors: 0, current: null, done: false, log: ["Preparing… resolving projects"] } };
    case "backup_start":
      return {
        ...s,
        backup: { ...s.backup, active: true, preparing: false, total: ev.project_count, completed: 0, skipped: 0, errors: 0, current: null, done: false, log: [`Backing up ${ev.project_count} project(s)…`] },
      };
    case "project_start":
      return { ...s, backup: { ...s.backup, current: ev.project_name, log: [...s.backup.log, `→ ${ev.project_name}`] } };
    case "project_done":
      return {
        ...s,
        backup: {
          ...s.backup, completed: s.backup.completed + 1, current: null,
          log: [...s.backup.log, `✓ ${ev.project_name} — ${ev.file_count} sample(s)${ev.missing_count ? `, ${ev.missing_count} missing` : ""}`],
        },
      };
    case "project_skipped":
      return { ...s, backup: { ...s.backup, skipped: s.backup.skipped + 1, current: null, log: [...s.backup.log, `↷ ${ev.project_name} — unchanged, skipped`] } };
    case "project_error":
      return { ...s, backup: { ...s.backup, errors: s.backup.errors + 1, current: null, log: [...s.backup.log, `✗ ${ev.project_name}: ${ev.error}`] } };
    case "backup_done":
      return { ...s, backup: { ...s.backup, active: false, preparing: false, done: true, log: [...s.backup.log, `Done — ${ev.ok_count} backed up, ${ev.skipped_count} unchanged, ${ev.error_count} error(s).`] } };
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
