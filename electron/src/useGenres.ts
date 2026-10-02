import { useEffect, useState } from "react";
import { makeApi } from "./api";

const api = makeApi();

// Each project's genre from the Library, keyed by project file and by name, so screens
// that only know a project's name or path still draw the same cover as the Library.
export function useGenres(refresh?: unknown): (name: string, path?: string) => string | null {
  const [map, setMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    api.library().then((r) => {
      if (!alive) return;
      const m = new Map<string, string>();
      for (const it of r.projects) {
        if (!it.genre) continue;
        m.set(`p:${it.path}`, it.genre);
        if (!m.has(`n:${it.name}`)) m.set(`n:${it.name}`, it.genre);
      }
      setMap(m);
    }).catch(() => {});
    return () => { alive = false; };
  }, [refresh]);
  return (name, path) => (path && map.get(`p:${path}`)) || map.get(`n:${name}`) || null;
}
