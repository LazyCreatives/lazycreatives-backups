import slothUrl from "../assets/lazy-creatives-sloth.png";
import huggingDriveUrl from "../assets/sloth-hugging-drive.png";
import nappingUrl from "../assets/sloth-napping.webp";
import nappingStillUrl from "../assets/sloth-napping.png";
import magnifierUrl from "../assets/sloth-magnifier.webp";
import magnifierStillUrl from "../assets/sloth-magnifier.png";

// The sloth on an empty or error screen. SHARED FILE: the same file lives in Backups
// and Uploader (electron/src/components/SlothSpot.tsx); change both together.
// `pose` names the drawing each spot is waiting for (napping, peering into an empty
// crate, tangled in a cable, …); until those arrive every spot shows the house sloth.
export type SlothPose = "napping" | "empty-crate" | "tangled" | "waving" | "searching" | "thumbs-up" | "hugging-drive";

// The artist's drawings that have arrived so far; any pose not listed shows the house sloth.
const DRAWN: Partial<Record<SlothPose, string>> = {
  "hugging-drive": huggingDriveUrl,
  napping: nappingUrl,
  searching: magnifierUrl,
};
// Moving drawings hold still for people who turn animations off in their computer's settings.
const STILL: Partial<Record<SlothPose, string>> = {
  napping: nappingStillUrl,
  searching: magnifierStillUrl,
};

export function SlothSpot({ pose, size = 84 }: { pose: SlothPose; size?: number }) {
  return (
    <span className={`slothspot slothspot--${pose}${DRAWN[pose] ? " slothspot--drawn" : ""}`} data-pose={pose} style={{ width: size, height: size }} aria-hidden="true">
      <picture style={{ display: "contents" }}>
        {STILL[pose] && <source media="(prefers-reduced-motion: reduce)" srcSet={STILL[pose]} />}
        <img src={DRAWN[pose] ?? slothUrl} alt="" draggable={false} />
      </picture>
    </span>
  );
}

// Plain message for an empty page: the sloth, a title, a next step and maybe a button.
// `say` is the sloth's own short line, shown in a speech bubble beside it.
export function EmptyState({ pose, title, say, children, action }: {
  pose: SlothPose; title: string; say?: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="empty empty--sloth">
      {/* the artist's drawings are detailed, so they get more room than the house sloth */}
      <SlothSpot pose={pose} size={DRAWN[pose] ? 148 : undefined} />
      {say && <div className="empty__say">{say}</div>}
      <div className="empty__title">{title}</div>
      {children && <div className="empty__body">{children}</div>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}
