import gzip
from pathlib import Path


def fileref_abs(abs_path: str, name: str) -> str:
    """Live 11/12 style: absolute Path Value."""
    return (
        "<SampleRef><FileRef>"
        f'<Path Value="{abs_path}"/>'
        f'<Name Value="{name}"/>'
        "</FileRef></SampleRef>"
    )


def fileref_rel(rel_path: str, name: str) -> str:
    """Live 11/12 style: RelativePath Value (relative to project)."""
    return (
        "<SampleRef><FileRef>"
        f'<RelativePath Value="{rel_path}"/>'
        f'<Name Value="{name}"/>'
        "</FileRef></SampleRef>"
    )


def fileref_legacy(dir_chain: list[str], name: str) -> str:
    """Live 9/10 style: RelativePathElement Dir chain + Name."""
    elems = "".join(
        f'<RelativePathElement Id="{i}" Dir="{d}"/>'
        for i, d in enumerate(dir_chain)
    )
    return (
        "<SampleRef><FileRef>"
        f"<RelativePath>{elems}</RelativePath>"
        f'<Name Value="{name}"/>'
        "</FileRef></SampleRef>"
    )


def write_als(path: Path, filerefs: list[str]) -> Path:
    """Write a minimal gzipped .als containing the given FileRef snippets."""
    body = "".join(filerefs)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Ableton MajorVersion="5" MinorVersion="11.0">'
        f"<LiveSet><Tracks>{body}</Tracks></LiveSet>"
        "</Ableton>"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        fh.write(xml)
    return path
