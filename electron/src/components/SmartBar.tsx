import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { openMenu, toast } from "./Desktop";
import { deleteSmartCrate, renameSmartCrate, restoreSmartCrate, sameFilters, saveSmartCrate, useSmartCrates, type SmartCrate } from "../smart";

// The row of smart crates over a list: one click shows what a saved crate holds
// right now, "Save as smart crate" keeps the search and filters you have on.
// Right-click a crate to rename or delete it. SHARED FILE: the same file lives in
// Backups and Uploader (electron/src/components/SmartBar.tsx); change both together.
export function SmartBar<F extends object>({ scope, filters, blank, canSave, suggest, count, onPick }: {
  scope: string;
  filters: F;                         // what's on now
  blank: F;                           // no filters at all (older crates are filled in from it)
  canSave: boolean;                   // something is filtered, so there is something to save
  suggest: (f: F) => string;          // a name made from the filters ("House · 120–129 BPM")
  count?: (f: F) => number;           // how many fit each crate right now
  onPick: (f: F | null) => void;      // null: clear the filters
}) {
  const crates = useSmartCrates<F>(scope);
  const full = (c: SmartCrate<F>) => ({ ...blank, ...c.filters });
  const on = crates.find((c) => sameFilters(full(c), filters));
  const [naming, setNaming] = useState<{ id: string | null; text: string } | null>(null);
  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (naming) { box.current?.focus(); box.current?.select(); } }, [!!naming]);
  if (!crates.length && !canSave) return null;

  const finish = () => {
    if (!naming) return;
    const text = naming.text.trim();
    if (text) {
      if (naming.id) renameSmartCrate(scope, naming.id, text);
      else { saveSmartCrate(scope, text, filters); toast(`Saved “${text}”. It keeps itself up to date.`); }
    }
    setNaming(null);
  };
  const remove = (c: SmartCrate<F>) => {
    const at = crates.indexOf(c);
    deleteSmartCrate(scope, c.id);
    toast(`Deleted “${c.name}”.`, { label: "Undo", onClick: () => restoreSmartCrate(scope, c, at) });
  };

  return (
    <div className="smartbar" role="group" aria-label="Smart crates">
      <span className="smartbar__label"><Icon name="crate" size={14} />Smart crates</span>
      {crates.map((c) => naming?.id === c.id ? (
        <NameBox key={c.id} box={box} value={naming.text} label={`New name for ${c.name}`}
          onChange={(text) => setNaming({ id: c.id, text })} onDone={finish} onCancel={() => setNaming(null)} />
      ) : (
        <button key={c.id} type="button" className={`smartchip${on === c ? " smartchip--on" : ""}`} aria-pressed={on === c}
          title={on === c ? "Showing this crate. Click to clear it" : `Show ${c.name}`}
          onClick={() => onPick(on === c ? null : full(c))}
          onContextMenu={(e) => openMenu(e, [
            { label: "Rename…", onClick: () => setNaming({ id: c.id, text: c.name }) },
            { label: "Delete", danger: true, onClick: () => remove(c) },
          ])}>
          <span className="smartchip__name">{c.name}</span>
          {count && <span className="smartchip__n">{count(full(c))}</span>}
        </button>
      ))}
      {naming && naming.id === null ? (
        <NameBox box={box} value={naming.text} label="Name for the new smart crate"
          onChange={(text) => setNaming({ id: null, text })} onDone={finish} onCancel={() => setNaming(null)} />
      ) : canSave && !on ? (
        <button type="button" className="smartbar__add" onClick={() => setNaming({ id: null, text: suggest(filters) })}>
          <Icon name="plus" size={13} />Save as smart crate
        </button>
      ) : null}
    </div>
  );
}

function NameBox({ box, value, label, onChange, onDone, onCancel }: {
  box: React.MutableRefObject<HTMLInputElement | null>; value: string; label: string;
  onChange: (v: string) => void; onDone: () => void; onCancel: () => void;
}) {
  return (
    <form className="smartbar__name" onSubmit={(e) => { e.preventDefault(); onDone(); }}>
      <input ref={box} type="text" value={value} aria-label={label} spellCheck={false} maxLength={40}
        onChange={(e) => onChange(e.target.value)} onBlur={onDone}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }} />
      <button type="submit" className="btn btn--sm btn--primary" onMouseDown={(e) => e.preventDefault()}>Save</button>
    </form>
  );
}
