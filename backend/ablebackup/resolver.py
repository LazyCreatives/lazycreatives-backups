from pathlib import Path

from ablebackup.models import FileRef, ResolvedRef


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


def resolve_refs(refs: list[FileRef], project_dir: Path) -> list[ResolvedRef]:
    resolved: list[ResolvedRef] = []
    for ref in refs:
        chosen: Path | None = None
        for cand in _candidates(ref, project_dir):
            if cand.exists():
                chosen = cand
                break
        if chosen is not None:
            resolved.append(ResolvedRef(
                name=ref.name or chosen.name,
                resolved_path=chosen,
                exists=True,
                inside_project=_is_inside(chosen, project_dir),
                size=chosen.stat().st_size,
            ))
        else:
            resolved.append(ResolvedRef(
                name=ref.name,
                resolved_path=None,
                exists=False,
                inside_project=False,
                size=0,
            ))
    return resolved
