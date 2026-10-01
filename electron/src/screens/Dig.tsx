import { useRef } from "react";
import { PageHeader } from "../components/PageHeader";
import { WaveBackdrop, useSpecular } from "../components/Glass";
import { CrateView } from "./Crate/CrateView";
import "../home.css";

// Top-level Dig: crate-dig the WHOLE scanned library, same shell as Home
// (waveform + glass material). Picking a record hands off to the Library,
// which owns project details + backups.
export function Dig({ onOpenProject }: { onOpenProject: (name: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useSpecular(rootRef);
  return (
    <div ref={rootRef} style={{ position: "relative", zIndex: 1 }}>
      <WaveBackdrop energized={false} />
      <PageHeader title="Crates"
        subtitle="Flip through your whole library, crate-digger style. Every record backed up & proven to open." />
      <CrateView onOpenProject={onOpenProject} />
    </div>
  );
}
