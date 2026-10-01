import lockupUrl from "../assets/lazy-creatives-lockup.png";

// The Lazy Creatives lockup (brand/logo.png): the headphone sloth + hand-lettered
// wordmark in Sloth Blue. `active` adds a soft working-glow — the brand-v2 stand-in
// for the old waveform bounce, until the commissioned mascot poses land.
export function BrandMark({ active = false }: { active?: boolean }) {
  return (
    <img
      className={`brandlockup${active ? " brandlockup--busy" : ""}`}
      src={lockupUrl}
      alt="Lazy Creatives"
      draggable={false}
    />
  );
}
