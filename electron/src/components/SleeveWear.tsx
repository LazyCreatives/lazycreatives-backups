import { PaperTexture } from "@paper-design/shaders-react";
import { hash } from "../look";

// The look of a real printed sleeve that has been handled: card fibres, a soft fold and
// a few creases, laid over a big cover and multiplied into its colours. Drawn once by
// the graphics card (Paper Shaders) and then held still. Only for the one big cover on
// a screen: every copy is its own drawing surface, so never use it in lists. Skipped when
// the computer can't draw it, and the cover simply shows without it.
let canDraw: boolean | null = null;
function webglOk(): boolean {
  if (canDraw === null) {
    try { canDraw = !!document.createElement("canvas").getContext("webgl2"); } catch { canDraw = false; }
  }
  return canDraw;
}

export function SleeveWear({ name }: { name: string }) {
  if (typeof document === "undefined" || !webglOk()) return null;
  const h = hash(name);
  return (
    <PaperTexture className="sleeve-wear" aria-hidden speed={0} frame={0} maxPixelCount={400 * 400}
      seed={h % 97} angle={h % 360}
      colorBack="#ffffff" colorPaper="#ffffff" colorShadow="#8f8879"
      roughness={0.35} roughnessSize={0.5} fiber={0.45} fiberSize={0.4}
      folds={0.55} foldSizeX={0.6} foldSizeY={0.3} foldOffsetX={((h >> 3) % 40) / 100} foldOffsetY={0}
      wrinkles={0.25} wrinkleSize={0.5} crumples={0.15} crumpleCount={0.4} drops={0} distortion={0} blending={0} />
  );
}
