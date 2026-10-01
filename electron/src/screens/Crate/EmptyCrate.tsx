import slothUrl from "../../assets/lazy-creatives-sloth.png";

export function EmptyCrate({ message }: { message?: string }) {
  return (
    <div className="crate-empty">
      <img src={slothUrl} alt="" draggable={false} />
      <div>{message ?? "Nothing in this crate yet — point me at a projects folder."}</div>
    </div>
  );
}
