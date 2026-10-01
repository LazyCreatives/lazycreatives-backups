import slothUrl from "../assets/lazy-creatives-sloth.png";

// Placeholder mascot for empty / idle states. One character for now; swap in the
// per-pose art (napping · scanning · backing-up · verified · loading) once the
// commissioned sloth set lands — see brand/brand-guide.html "Assets to commission".
export function SlothMascot({ size = 76, label = "" }: { size?: number; label?: string }) {
  return (
    <img className="sloth-mascot" src={slothUrl} alt={label} draggable={false}
      style={{ width: size, height: "auto" }} />
  );
}
