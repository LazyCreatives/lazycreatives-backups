from pathlib import Path
from typing import Callable, Optional

from ablebackup.models import FileRef, ResolvedRef

Locator = Optional[Callable[[str], Optional[Path]]]


def _candidates(ref: FileRef, project_dir: Path) -> list[Path]:
    out: list[Path] = []
    if ref.absolute_path:
        out.append(Path(ref.absolute_path))
    if ref.relative_path:
        out.append(project_dir / Path(ref.relative_path.replace("\\", "/")))
    return out


def _is_inside(path: Path, project_dir: Path) -> bool:
    try:
        path.resolve().relative_to(project_dir.resolve())
        return True
    except ValueError:
        return False


def _safe_size(p: Path) -> int:
    try:
        return p.stat().st_size
    except OSError:
        return -1


def _path_tail_score(ref_path: str, cand: Path) -> int:
    """How many trailing path segments the candidate shares with the reference."""
    a = ref_path.replace("\\", "/").lower().split("/")
    b = str(cand).replace("\\", "/").lower().split("/")
    n = 0
    while n < len(a) and n < len(b) and a[-1 - n] == b[-1 - n]:
        n += 1
    return n


def _match_located(ref: FileRef, locate: Locator) -> Optional[Path]:
    """Pick a library file that genuinely matches the referenced sample.

    A basename alone is not enough — many different samples share a name. We
    require the size Ableton recorded (OriginalFileSize) to match, then break ties
    by path overlap. If the correctly-sized file isn't present, we relink NOTHING
    rather than silently back up a different same-named sample.
    """
    if locate is None:
        return None
    ref_path = ref.relative_path or ref.absolute_path or ref.name or ""
    name = Path(ref_path).name
    if not name:
        return None
    cands = [c for c in locate(name) if c.is_file()]
    if not cands:
        return None
    if ref.size:
        cands = [c for c in cands if _safe_size(c) == ref.size]
        if not cands:
            return None  # the file with the recorded size isn't here — don't guess
    cands.sort(key=lambda c: _path_tail_score(ref_path, c), reverse=True)
    best = cands[0]
    # Accept only when we verified by size, or matched a strong path tail (dir + name).
    if ref.size or _path_tail_score(ref_path, best) >= 2:
        return best
    return None


def resolve_refs(refs: list[FileRef], project_dir: Path,
                 locate: Locator = None) -> list[ResolvedRef]:
    resolved: list[ResolvedRef] = []
    # A sample used by N clips appears as N identical FileRefs; collapse them so
    # counts and sizes reflect unique files, not how many times each is triggered.
    seen: set[str] = set()
    for ref in refs:
        chosen: Path | None = None
        relinked = False
        for cand in _candidates(ref, project_dir):
            # Only real files are backable. A reference can resolve to a directory
            # (e.g. an Ableton built-in device bundle like Simpler inside the .app);
            # those are not user samples and must not be hashed/copied as files.
            if cand.is_file():
                chosen = cand
                break
        if chosen is None and locate is not None:
            # Not where the project points — try to find it in the user's libraries
            # (Splice, etc.), but only accept a file that actually matches (size +
            # path), never a same-named guess. See _match_located.
            found = _match_located(ref, locate)
            if found is not None:
                chosen = found
                relinked = True
        if chosen is not None:
            key = str(chosen.resolve())
            if key in seen:
                continue
            seen.add(key)
            st = chosen.stat()
            resolved.append(ResolvedRef(
                name=ref.name or chosen.name,
                resolved_path=chosen,
                exists=True,
                inside_project=_is_inside(chosen, project_dir),
                size=st.st_size,
                mtime=st.st_mtime,
                relinked=relinked,
            ))
        else:
            expected = ref.relative_path or ref.absolute_path or ref.name
            if f"missing::{expected}" in seen:
                continue
            seen.add(f"missing::{expected}")
            resolved.append(ResolvedRef(
                name=ref.name,
                resolved_path=None,
                exists=False,
                inside_project=False,
                size=0,
                expected_path=expected,
            ))
    return resolved
