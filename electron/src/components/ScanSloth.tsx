import type { ScanProgress } from "../useProgress";
import { SlothSpot } from "./SlothSpot";
import { Rolling } from "./Rolling";
import { fmtCount } from "../format";

// The first look through the folders, while nothing is in the library yet: the sloth with
// its magnifier, and the real count rolling up as projects turn up. Only what has actually
// been found is shown; before the scan reports anything, just the sloth and the words.
export function ScanSloth({ scan }: { scan: ScanProgress }) {
  const reading = scan.phase === "parsing" && scan.total > 0;
  const n = reading ? scan.total : scan.found;
  return (
    <div className="empty empty--sloth scansloth">
      <SlothSpot pose="searching" size={148} />
      <div className="empty__say">Digging through your folders.</div>
      <div className="empty__title">
        {n > 0 ? <><Rolling value={n} /> project{n === 1 ? "" : "s"} found so far</> : "Looking for your projects…"}
      </div>
      <div className="empty__body">
        {reading ? <>Reading them: <Rolling value={scan.done} /> of {fmtCount(scan.total)}</>
          : scan.dirs > 0 ? <><Rolling value={scan.dirs} /> folder{scan.dirs === 1 ? "" : "s"} looked in</>
          : "Every Ableton, FL Studio, Logic Pro, Studio One, Reaper, Audacity, Bitwig and DAWproject project counts."}
      </div>
    </div>
  );
}
