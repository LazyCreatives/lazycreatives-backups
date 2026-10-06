import { Cover } from "./Cover";
import { genreColor, useLook, useTheme, type ThemeChoice } from "../look";

// The whole-app look switch: Crate (rows like a DJ library) or Sleeve (cover art first).
// Switching takes effect at once on every screen.
export function LookPicker() {
  const [look, setLook] = useLook();
  return (
    <div className="lookpick" role="group" aria-label="Look">
      {([["crate", "Crate", "Rows like a DJ library, with waveforms and genre stripes"],
         ["sleeve", "Sleeve", "Cover art first, like an album shelf"]] as const).map(([k, name, what]) => (
        <button key={k} type="button" className="lookpick__opt" aria-pressed={look === k} onClick={() => setLook(k)}>
          <LookThumb kind={k} />
          <span><strong style={{ fontWeight: 600 }}>{name}</strong><br /><small>{what}</small></span>
        </button>
      ))}
    </div>
  );
}

// Light or dark, under the look switch in Settings: Dark (the default), Light (paper),
// or Match my computer (follows the computer's own setting, even when it changes).
export function ThemePicker() {
  const [choice, setChoice] = useTheme();
  const opts: [ThemeChoice, string, string][] = [
    ["dark", "Dark", "Ink, easy on the eyes at night"],
    ["light", "Light", "Paper, for bright rooms"],
    ["system", "Match my computer", "Follows your computer's setting"],
  ];
  return (
    <div className="lookpick themepick" role="group" aria-label="Light or dark">
      {opts.map(([k, name, what]) => (
        <button key={k} type="button" className="lookpick__opt" aria-pressed={choice === k} onClick={() => setChoice(k)}>
          <span className={`themepick__thumb themepick__thumb--${k}`} aria-hidden>
            <span><i /><i /><i /></span><span><i /><i /><i /></span>
          </span>
          <span><strong style={{ fontWeight: 600 }}>{name}</strong><br /><small>{what}</small></span>
        </button>
      ))}
    </div>
  );
}

function LookThumb({ kind }: { kind: "crate" | "sleeve" }) {
  const demo = [["Grime riddim 140", "Grime"], ["DNB roller", "DnB"], ["Garage sunday", "UK garage"], ["Lo-fi rain", "Lo-fi"]];
  if (kind === "sleeve") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
        {demo.map(([n, g]) => <Cover key={n} name={n} genre={g} label={false} className="lookpick__cover" />)}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 3 }}>
      {demo.slice(0, 3).map(([n, g], i) => (
        <div key={n} style={{ display: "grid", gridTemplateColumns: "3px 14px 1fr", gap: 6, alignItems: "center",
          height: 16, background: i % 2 ? "var(--zebra-solid)" : "transparent" }}>
          <span style={{ background: genreColor(g), alignSelf: "stretch" }} />
          <Cover name={n} genre={g} size={14} label={false} />
          <span style={{ height: 4, borderRadius: 2, background: genreColor(g), opacity: 0.6, width: `${60 + i * 12}%` }} />
        </div>
      ))}
    </div>
  );
}
