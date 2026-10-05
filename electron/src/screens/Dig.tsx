import { PageHeader } from "../components/PageHeader";
import { CrateView } from "./Crate/CrateView";

// Top-level Dig: flip through the whole scanned library as crates of records.
// Picking a record hands off to the Library, which owns project details + backups.
export function Dig({ openCrate, onOpenCrate, onCloseCrate, onOpenProject }: {
  openCrate: string | null; onOpenCrate: (key: string) => void; onCloseCrate: () => void;
  onOpenProject: (name: string) => void;
}) {
  return (
    <div>
      <PageHeader title="Dig"
        subtitle="Flip through your whole library as crates of records, grouped the way you choose." />
      <CrateView openKey={openCrate} onOpenKey={onOpenCrate} onCloseKey={onCloseCrate} onOpenProject={onOpenProject} />
    </div>
  );
}
