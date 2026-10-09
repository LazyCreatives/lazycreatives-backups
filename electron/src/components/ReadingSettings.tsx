import { Choice, OnOff, SetRow } from "./SetRow";
import { SIZES, useReading, type ReadFont, type ReadSpace, type ReadTint } from "../reading";

// Easier reading, on the Look tab of Settings in both apps (see reading.ts and
// reading.css). One switch; the fine-tunes show once it is on. Same file in Backups
// and Uploader.
const FONTS: readonly (readonly [ReadFont, string])[] = [["atkinson", "Atkinson Hyperlegible"], ["opendyslexic", "OpenDyslexic"], ["app", "The app's own"]];
const SPACES: readonly (readonly [ReadSpace, string])[] = [["normal", "Normal"], ["wider", "Wider"], ["widest", "Widest"]];
const TINTS: readonly (readonly [ReadTint, string])[] = [["none", "None"], ["cream", "Cream"], ["blue", "Blue"], ["grey", "Grey"]];
const SIZE_OPTS = SIZES.map((s) => [String(s), `${Math.round(s * 100)}%`] as const);

export function ReadingSettings() {
  const [r, set] = useReading();
  return <>
    <SetRow title="Easier reading"
      help="For dyslexia or tired eyes: a clearer font, more space between letters and words, bigger text, no capital-letter labels and less movement.">
      <OnOff label="Easier reading" on={r.on} onChange={(on) => set({ ...r, on })} />
    </SetRow>
    {r.on && <>
      <SetRow title="Text size" help="Everything grows together, so lists stay lined up.">
        <Choice label="Text size" value={String(r.size)} options={SIZE_OPTS} onChange={(v) => set({ ...r, size: Number(v) })} />
      </SetRow>
      <SetRow title="Spacing" help="Room between letters and words. Long names end in … and show in full when you point at them.">
        <Choice label="Spacing" value={r.space} options={SPACES} onChange={(space) => set({ ...r, space })} />
      </SetRow>
      <SetRow title="Font" help="Atkinson Hyperlegible draws b d p q and I l 1 so they can't be mixed up. Pick whichever feels easiest.">
        <Choice label="Font" value={r.font} options={FONTS} onChange={(font) => set({ ...r, font })} />
        <p className="read-sample" aria-hidden>b d p q · I l 1 · 0 O · Midnight Drive final</p>
      </SetRow>
      <SetRow title="Colour tint" help="A light wash of colour over the window, like a reading sheet. Some people find one colour calmer.">
        <Choice label="Colour tint" value={r.tint} options={TINTS} onChange={(tint) => set({ ...r, tint })} />
      </SetRow>
      <SetRow title="Less movement" help="No fades, slides or numbers counting up.">
        <OnOff label="Less movement" on={r.calm} onChange={(calm) => set({ ...r, calm })} />
      </SetRow>
    </>}
  </>;
}
