import { EmptyState } from "../../components/SlothSpot";

// Dig's empty shelf or empty crate, with the same sloth drawings as the other empty pages.
export function EmptyCrate({ title, children, searching }: {
  title: string; children?: React.ReactNode; searching?: boolean;
}) {
  return (
    <div className="crate-empty">
      <EmptyState pose={searching ? "searching" : "napping"} title={title}
        say={searching ? "Looked everywhere. Nothing." : "Empty crate. Back to my nap."}>
        {children}
      </EmptyState>
    </div>
  );
}
