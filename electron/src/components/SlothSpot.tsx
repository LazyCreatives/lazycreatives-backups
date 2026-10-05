import slothUrl from "../assets/lazy-creatives-sloth.png";

// The sloth on an empty or error screen. SHARED FILE: the same file lives in Backups
// and Uploader (electron/src/components/SlothSpot.tsx); change both together.
// `pose` names the drawing each spot is waiting for (napping, peering into an empty
// crate, tangled in a cable, …); until those arrive every spot shows the house sloth.
export type SlothPose = "napping" | "empty-crate" | "tangled" | "waving" | "searching" | "thumbs-up";

export function SlothSpot({ pose, size = 84 }: { pose: SlothPose; size?: number }) {
  return (
    <span className={`slothspot slothspot--${pose}`} data-pose={pose} style={{ width: size, height: size }} aria-hidden="true">
      <img src={slothUrl} alt="" draggable={false} />
    </span>
  );
}

// Plain message for an empty page: the sloth, a title, a next step and maybe a button.
export function EmptyState({ pose, title, children, action }: {
  pose: SlothPose; title: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="empty empty--sloth">
      <SlothSpot pose={pose} />
      <div className="empty__title">{title}</div>
      {children && <div className="empty__body">{children}</div>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}
