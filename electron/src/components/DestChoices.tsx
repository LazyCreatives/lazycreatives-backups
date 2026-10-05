import { useEffect, useState } from "react";
import { makeApi } from "../api";
import type { CloudFolder } from "../types";
import { currentOs, osWords } from "../platform";
import { Icon } from "./Icon";

const api = makeApi();

// "/Users/rob/Dropbox" -> "~/Dropbox", the way people know their folders. The Mac's
// hidden cloud folders show by name: "Google Drive/My Drive", "iCloud Drive".
export function tildePath(p: string): string {
  const mac = p.match(/^\/Users\/[^/]+\/Library\/(?:CloudStorage\/([^/]+)|Mobile Documents\/com~apple~CloudDocs)(.*)$/);
  if (mac) {
    const top = mac[1] === undefined ? "iCloud Drive" : mac[1].startsWith("GoogleDrive-") ? "Google Drive" : mac[1];
    return top + mac[2];
  }
  return p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, "~");
}

function join(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

// The cloud apps worth offering here: always Dropbox, Google Drive and OneDrive;
// iCloud Drive on a Mac (or wherever its folder turns up).
export function useCloudFolders() {
  const [folders, setFolders] = useState<CloudFolder[]>([]);
  const [subdir, setSubdir] = useState("Lazy Creatives Backups");
  useEffect(() => {
    api.cloudFolders().then((r) => { setFolders(r.folders); setSubdir(r.subdir); }).catch(() => {});
  }, []);
  const mac = currentOs() === "mac";
  const shown = folders.filter((f) => f.key !== "icloud" || mac || f.path);
  // Backups go in their own folder inside the cloud one, never loose in its top level.
  const destFor = (dir: string) => join(dir, subdir);
  return { folders: shown, destFor };
}

export type DestChoice = { kind: "drive" } | { kind: "cloud"; key: string };

const CLOUD_ICON: Record<string, string> = { dropbox: "DB", gdrive: "GD", icloud: "iC", onedrive: "OD" };

// The "where should backups go?" list on the first-run screen: one row per place,
// same columns on every row: mark · name · where it is · button.
export function DestChoices({ dest, choice, onPick }: {
  dest: string;
  choice: DestChoice | null;
  onPick: (dest: string, choice: DestChoice) => void;
}) {
  const { folders, destFor } = useCloudFolders();
  const words = osWords();
  const pick = async () => (await (window as any).ablebackup?.pickFolder?.()) as string | undefined;

  async function chooseDrive() {
    const dir = await pick();
    if (dir) onPick(dir, { kind: "drive" });
  }
  async function chooseCloud(f: CloudFolder) {
    const dir = f.path ?? await pick();
    if (dir) onPick(destFor(dir), { kind: "cloud", key: f.key });
  }
  const on = (c: DestChoice) => choice?.kind === c.kind && (c.kind === "drive" || (choice as any).key === (c as any).key);

  const driveOn = on({ kind: "drive" });
  return (
    <div className="dest-list" role="radiogroup" aria-label="Where backups go">
      <div className={`dest-row${driveOn ? " dest-row--on" : ""}`} role="radio" aria-checked={driveOn}>
        <span className="dest-row__mark"><Icon name="disc" size={17} /></span>
        <span className="dest-row__name">Your own drive or NAS</span>
        <span className="dest-row__where mono" title={driveOn ? dest : undefined}>
          {driveOn ? tildePath(dest) : "External drive, NAS or any folder"}
        </span>
        <button className="btn btn--sm btn--ghost dest-row__btn" onClick={chooseDrive}>{driveOn ? "Change…" : "Choose…"}</button>
      </div>
      {folders.map((f) => {
        const c: DestChoice = { kind: "cloud", key: f.key };
        const isOn = on(c);
        return (
          <div key={f.key} className={`dest-row${isOn ? " dest-row--on" : ""}${f.path ? "" : " dest-row--missing"}`} role="radio" aria-checked={isOn}>
            <span className={`dest-row__mark dest-row__mark--${f.key}`}>{CLOUD_ICON[f.key] ?? "☁"}</span>
            <span className="dest-row__name">{f.label}</span>
            <span className="dest-row__where mono" title={isOn ? dest : f.path ?? undefined}>
              {isOn ? tildePath(dest) : f.path ? tildePath(f.path) : `Not found on this ${words.computer}`}
            </span>
            <button className="btn btn--sm btn--ghost dest-row__btn" onClick={() => chooseCloud(f)}
              aria-label={f.path ? `Use ${f.label}` : `Find your ${f.label} folder`}>
              {isOn ? <><Icon name="check" size={13} />Chosen</> : f.path ? "Use" : "Find folder…"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
