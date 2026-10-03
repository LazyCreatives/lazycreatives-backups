import os
import re
from pathlib import Path
from typing import Callable, Optional

from ablebackup.models import FileRef, ResolvedRef

Locator = Optional[Callable[[str], Optional[Path]]]

_SEP = re.compile(r"[\\/]+")


def basename(p: str) -> str:
    """The file name of a stored path, whichever OS wrote it. Path(p).name keeps the
    whole string for a Windows path read on a Mac ("C:\\x\\kick.wav")."""
    parts = [s for s in _SEP.split(p or "") if s]
    return parts[-1] if parts else ""


def is_unc(p: str) -> bool:
    """A network-share path: \\\\PC-NAME\\Share\\..."""
    return p.startswith("\\\\") or p.startswith("//")


def _direct_candidates(ref: FileRef, project_dir: Path) -> list[Path]:
    out: list[Path] = []
    if ref.absolute_path:
        out.append(Path(ref.absolute_path))
    if ref.relative_path:
        out.append(project_dir / Path(ref.relative_path.replace("\\", "/")))
    return out


def _rerooted(stored: str) -> Optional[Path]:
    """The same file under THIS computer's home folder.

    A path saved as \\\\BLUB_PC\\Users\\blub\\Samples\\kick.wav (the PC's own folders
    reached as a network share), C:\\Users\\olduser\\Samples\\kick.wav (another PC or
    user name) or /Users/me/Samples/kick.wav (a Mac) is usually the very same file
    at <home>/Samples/kick.wav here. The whole path below the user folder has to
    match, so this is a much stronger match than a file name alone."""
    parts = [s for s in _SEP.split(stored or "") if s]
    for i, seg in enumerate(parts[:-2]):
        if seg.lower() in ("users", "home", "documents and settings"):
            tail = parts[i + 2:]
            cand = Path.home().joinpath(*tail)
            return None if str(cand) == stored else cand
    return None


def _candidates(ref: FileRef, project_dir: Path) -> list[Path]:
    """Where to look for a referenced file: the paths the project stores, then the
    same file under this computer's home folder (see _rerooted)."""
    out = _direct_candidates(ref, project_dir)
    for stored in (ref.absolute_path, ref.relative_path):
        alt = _rerooted(stored) if stored else None
        if alt is not None and alt not in out:
            out.append(alt)
    return out


def first_existing(ref: FileRef, project_dir: Path,
                   unreachable: Optional[set[str]] = None) -> tuple[Optional[Path], bool]:
    """The file a reference points at on this computer, and whether it was found
    somewhere other than the stored path (under the home folder). Shared by the
    resolver and the portable-copy rewriters so both always pick the same file."""
    unreachable = set() if unreachable is None else unreachable
    direct = _direct_candidates(ref, project_dir)
    for cand in _candidates(ref, project_dir):
        # Only real files are backable. A reference can resolve to a directory
        # (e.g. an Ableton built-in device bundle like Simpler inside the .app);
        # those are not user samples and must not be hashed/copied as files.
        if not (_reachable(cand, unreachable) and cand.is_file()):
            continue
        if cand in direct:
            return cand, False
        # Found under this computer's home folder, not at the stored path. A
        # recorded size must still agree (Ableton), or it's not the same file.
        if ref.size and _safe_size(cand) != ref.size:
            continue
        return cand, True
    return None, False


def _share_root(p: str) -> Optional[str]:
    parts = [s for s in _SEP.split(p) if s]
    return "\\\\" + "\\".join(parts[:2]) if len(parts) >= 2 else None


def _reachable(path: Path, unreachable: set[str]) -> bool:
    """False for a network-share path whose computer or share is gone. Each lookup of
    an offline share can stall for many seconds, so one failure skips the rest."""
    s = str(path)
    if not is_unc(s):
        return True
    root = _share_root(s)
    if root is None or root in unreachable:
        return False
    if os.name == "nt" and not os.path.isdir(root):
        unreachable.add(root)
        return False
    return True


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


# Media extensions a project may legitimately reference from OUTSIDE its own
# folder. A file resolving outside the project with any other extension is refused
# (treated as missing) so a crafted/received project can't pull arbitrary readable
# files — ~/.ssh/id_rsa, ~/.aws/credentials, etc. — into the backup via _External.
# Files INSIDE the project folder are unrestricted (they're the user's own).
_EXTERNAL_MEDIA_EXTS = {
    ".wav", ".aif", ".aiff", ".aifc", ".flac", ".mp3", ".ogg", ".oga", ".opus",
    ".m4a", ".aac", ".alac", ".wma", ".wv", ".caf", ".ape", ".mp2", ".w64",
    ".au", ".snd", ".rex", ".rx2", ".sf2", ".sfz", ".asd", ".nki", ".exs",
    ".mov", ".mp4", ".m4v", ".avi", ".mkv", ".mpg", ".mpeg", ".webm",
}


def _allowed_external_file(path: Path) -> bool:
    return path.suffix.lower() in _EXTERNAL_MEDIA_EXTS


def _match_located(ref: FileRef, locate: Locator) -> Optional[Path]:
    """Pick a library file that genuinely matches the referenced sample.

    A basename alone is not enough — many different samples share a name. When a
    size is recorded (Ableton's OriginalFileSize), we require it to match, then
    break ties by path overlap. When NO size is recorded (FL/Reaper/DAWproject
    refs carry size=0), we only relink on a strong AND UNIQUE path-tail match, so
    we never silently back up a different same-named sample on a tie. If we can't
    be confident, we relink nothing.
    """
    if locate is None:
        return None
    ref_path = ref.relative_path or ref.absolute_path or ref.name or ""
    name = basename(ref_path)
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
        return cands[0]  # size-verified — the recorded size already disambiguates
    # No recorded size: require a strong, UNIQUE path-tail match (dir + name) with
    # no other candidate tying the best score, else it's ambiguous — don't guess.
    cands.sort(key=lambda c: _path_tail_score(ref_path, c), reverse=True)
    best_score = _path_tail_score(ref_path, cands[0])
    if best_score >= 2 and all(_path_tail_score(ref_path, c) < best_score for c in cands[1:]):
        return cands[0]
    # FL Studio finds a moved sample by its file name in its search folders and
    # plays it. When exactly one file of that name is in the searched folders, it is
    # the file the DAW plays, so back that one up. Two or more is a guess: skip.
    if ref.name_match and len(cands) == 1:
        return cands[0]
    return None


def _ref_key(ref: FileRef) -> str:
    """The identifier a missing ref is shown and addressed by (matches
    ResolvedRef.expected_path): its relative path, else absolute, else name."""
    return ref.relative_path or ref.absolute_path or ref.name or ""


def resolve_refs(refs: list[FileRef], project_dir: Path,
                 locate: Locator = None,
                 overrides: Optional[dict] = None) -> list[ResolvedRef]:
    """Resolve each referenced sample to a real file on disk.

    `overrides` maps a missing ref's identifier (its expected path, as shown to the
    user; basename also accepted) to an exact file the user pointed at ("this missing
    sample IS that file"). An override takes priority over the project's own path and
    the library auto-finder, but still passes the same media-extension guard as any
    other out-of-project file, so a hostile caller can't remap a sample onto a secret.
    """
    overrides = overrides or {}
    resolved: list[ResolvedRef] = []
    # A sample used by N clips appears as N identical FileRefs; collapse them so
    # counts and sizes reflect unique files, not how many times each is triggered.
    seen: set[str] = set()
    # project_dir is constant for the whole project — resolve it once instead of in
    # _is_inside per ref (realpath is a syscall-heavy walk).
    project_real = project_dir.resolve()
    unreachable: set[str] = set()   # network shares already found offline
    for ref in refs:
        chosen: Path | None = None
        relinked = False
        # An explicit user remap wins over everything — they hand-picked this file.
        ov = overrides.get(_ref_key(ref)) or (ref.name and overrides.get(ref.name))
        if ov and Path(ov).is_file():
            chosen = Path(ov)
            relinked = True
        if chosen is None:
            chosen, relinked = first_existing(ref, project_dir, unreachable)
        if chosen is None and locate is not None:
            # Not where the project points — try to find it in the user's libraries
            # (Splice, etc.), but only accept a file that actually matches (size +
            # path), never a same-named guess. See _match_located.
            found = _match_located(ref, locate)
            if found is not None:
                chosen = found
                relinked = True
        inside = False
        if chosen is not None:
            # Resolve chosen once and reuse for both the dedup key and the
            # inside-project test (was resolved twice: here and inside _is_inside).
            chosen_real = chosen.resolve()
            try:
                chosen_real.relative_to(project_real)
                inside = True
            except ValueError:
                inside = False
            # Security: a file outside the project must be a media sample, never an
            # arbitrary readable file a crafted project points at.
            if not inside and not _allowed_external_file(chosen):
                chosen = None

        if chosen is not None:
            key = str(chosen_real)
            if key in seen:
                continue
            seen.add(key)
            st = chosen.stat()
            resolved.append(ResolvedRef(
                name=ref.name or chosen.name,
                resolved_path=chosen,
                exists=True,
                inside_project=inside,
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
