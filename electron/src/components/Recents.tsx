import { useEffect } from "react";
import { Cover } from "./Cover";
import { openMenu } from "./Desktop";
import { clearRecents, forgetRecent, noteOpened, openedAgo, useRecents } from "../recents";

// "Recently opened" in the sidebar: the last few projects (Backups) or tracks
// (Uploader) you opened, newest first. Click one to open it again; right-click to
// take it off the list or clear the list. Hidden when the sidebar shrinks to icons.
// SHARED FILE: the same file lives in Backups and Uploader
// (electron/src/components/Recents.tsx); change both together.

export const SIDEBAR_RECENTS = 5;

export function NavRecents({ onOpen, current }: { onOpen: (id: string) => void; current?: string | null }) {
  const list = useRecents().slice(0, SIDEBAR_RECENTS);
  if (!list.length) return null;
  const menu = (e: React.MouseEvent, id?: string) => openMenu(e, [
    ...(id ? [{ label: "Remove from this list", onClick: () => forgetRecent(id) }, "-" as const] : []),
    { label: "Clear the list", onClick: clearRecents },
  ]);
  return (
    <section className="nav__recents" aria-label="Recently opened" onContextMenu={(e) => menu(e)}>
      <h2 className="nav__recents-head">Recently opened</h2>
      {list.map((r) => {
        const on = r.id === current;
        return (
          <button key={r.id} type="button" className={`nav__recent${on ? " nav__recent--on" : ""}`}
            aria-current={on ? "page" : undefined} title={r.name}
            onClick={() => onOpen(r.id)} onContextMenu={(e) => menu(e, r.id)}>
            <Cover name={r.cover} genre={r.genre} size={22} label={false} />
            <span className="nav__recent-name">{r.name}</span>
            <span className="nav__recent-when">{openedAgo(r.at)}</span>
          </button>
        );
      })}
    </section>
  );
}

// Put on a project or track page: notes it as opened (again if its name or genre changes).
export function NoteOpened({ id, name, cover, genre }: { id: string; name: string; cover: string; genre?: string | null }) {
  useEffect(() => { noteOpened({ id, name, cover, genre: genre ?? null }); }, [id, name, cover, genre]);
  return null;
}
