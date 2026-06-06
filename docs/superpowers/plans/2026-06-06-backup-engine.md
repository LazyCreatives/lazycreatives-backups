# Ableton Backup Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested Python backup engine (plus a CLI driver) that scans for Ableton `.als` projects, resolves every file each project depends on, and writes deduplicated, self-contained dated snapshots to a destination folder (the mounted NAS).

**Architecture:** A small package `ablebackup` with focused modules — `models`, `als_parser`, `resolver`, `scanner`, `hashing`, `catalog`, `backup_engine` — and a `cli` that wires them end-to-end. Snapshots use a content-addressed pool (`_pool/<hash>`) with files hardlinked into each snapshot folder (fallback to copy when hardlinks are unsupported). This is Plan 1 of 3; the FastAPI/scheduler layer and the Electron/frontend app are separate later plans.

**Tech Stack:** Python 3.11+, mostly standard library (`gzip`, `hashlib`, `sqlite3`, `os`, `pathlib`, `shutil`, `json`, `argparse`) plus `defusedxml` for safe XML parsing (`.als` files are untrusted input — stdlib `xml.etree` is vulnerable to XXE / billion-laughs); `pytest` for tests.

---

## File Structure

```
backend/
  pyproject.toml                 # package + pytest config
  ablebackup/
    __init__.py
    models.py                    # dataclasses: FileRef, ResolvedRef, ProjectScan
    als_parser.py                # gunzip + XML → list[FileRef]
    resolver.py                  # FileRef + project_dir → ResolvedRef
    scanner.py                   # walk folders → list[ProjectScan]
    hashing.py                   # sha256 of a file
    catalog.py                   # SQLite history (snapshots, missing refs)
    backup_engine.py             # pool dedup + hardlink snapshot + manifest
    cli.py                       # argparse driver: scan / backup
  tests/
    __init__.py
    helpers.py                   # build synthetic .als fixtures
    test_als_parser.py
    test_resolver.py
    test_scanner.py
    test_hashing.py
    test_catalog.py
    test_backup_engine.py
    test_integration.py
```

Each module has one responsibility. `models` holds the shared dataclasses every other module references, so types stay consistent.

---

### Task 1: Project scaffolding

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/ablebackup/__init__.py`
- Create: `backend/tests/__init__.py`
- Test: `backend/tests/test_smoke.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_smoke.py`:
```python
import ablebackup

def test_package_imports():
    assert ablebackup.__version__ == "0.1.0"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_smoke.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup'`

- [ ] **Step 3: Write minimal implementation**

`backend/pyproject.toml`:
```toml
[project]
name = "ablebackup"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["defusedxml>=0.7"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

`backend/ablebackup/__init__.py`:
```python
__version__ = "0.1.0"
```

`backend/tests/__init__.py`: (empty file)

Install dependencies (`defusedxml` + `pytest`):
```bash
cd backend && python -m pip install -e . pytest
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_smoke.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "chore: scaffold ablebackup package and pytest"
```

---

### Task 2: Shared data models

**Files:**
- Create: `backend/ablebackup/models.py`
- Test: `backend/tests/test_models.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_models.py`:
```python
from pathlib import Path
from ablebackup.models import FileRef, ResolvedRef, ProjectScan


def test_fileref_defaults():
    ref = FileRef(name="kick.wav")
    assert ref.name == "kick.wav"
    assert ref.absolute_path is None
    assert ref.relative_path is None


def test_projectscan_missing_and_total_size(tmp_path):
    proj = ProjectScan(
        als_path=tmp_path / "song.als",
        name="song",
        project_dir=tmp_path,
        mtime=1.0,
        size=100,
    )
    present = ResolvedRef(name="a.wav", resolved_path=tmp_path / "a.wav",
                          exists=True, inside_project=True, size=50)
    absent = ResolvedRef(name="b.wav", resolved_path=None,
                         exists=False, inside_project=False, size=0)
    proj.refs = [present, absent]
    assert proj.missing == [absent]
    assert proj.total_size == 150  # 100 als + 50 present ref
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup.models'`

- [ ] **Step 3: Write minimal implementation**

`backend/ablebackup/models.py`:
```python
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class FileRef:
    """A raw file reference extracted from an .als, before resolution."""
    name: str
    absolute_path: Optional[str] = None     # from <Path Value=.../>
    relative_path: Optional[str] = None     # POSIX-style, from <RelativePath .../>


@dataclass
class ResolvedRef:
    """A file reference resolved against the filesystem."""
    name: str
    resolved_path: Optional[Path]
    exists: bool
    inside_project: bool
    size: int = 0


@dataclass
class ProjectScan:
    """A discovered Ableton project and its resolved dependencies."""
    als_path: Path
    name: str
    project_dir: Path
    mtime: float
    size: int
    refs: list[ResolvedRef] = field(default_factory=list)

    @property
    def missing(self) -> list[ResolvedRef]:
        return [r for r in self.refs if not r.exists]

    @property
    def total_size(self) -> int:
        return self.size + sum(r.size for r in self.refs if r.exists)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/models.py backend/tests/test_models.py
git commit -m "feat: add shared data models"
```

---

### Task 3: Test helper — synthetic .als fixtures

**Files:**
- Create: `backend/tests/helpers.py`
- Test: `backend/tests/test_helpers.py`

The `.als` format is gzipped XML. To test the parser without shipping real Ableton files, this
helper writes known XML, gzips it, and returns the path. It supports the three FileRef shapes the
parser must handle.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_helpers.py`:
```python
import gzip
from tests.helpers import write_als, fileref_abs, fileref_rel, fileref_legacy


def test_write_als_is_gzipped_xml(tmp_path):
    als = write_als(tmp_path / "song.als", [fileref_abs("/x/kick.wav", "kick.wav")])
    assert als.exists()
    with gzip.open(als, "rt", encoding="utf-8") as fh:
        text = fh.read()
    assert "<Ableton" in text
    assert "kick.wav" in text


def test_fixture_builders_return_xml_snippets():
    assert "Path" in fileref_abs("/x/a.wav", "a.wav")
    assert "RelativePath" in fileref_rel("Samples/a.wav", "a.wav")
    assert "RelativePathElement" in fileref_legacy(["Samples", "Imported"], "a.wav")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_helpers.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'tests.helpers'`

- [ ] **Step 3: Write minimal implementation**

`backend/tests/helpers.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_helpers.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tests/helpers.py backend/tests/test_helpers.py
git commit -m "test: add synthetic .als fixture helpers"
```

---

### Task 4: Parser — gunzip + extract absolute-path FileRefs

**Files:**
- Create: `backend/ablebackup/als_parser.py`
- Test: `backend/tests/test_als_parser.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_als_parser.py`:
```python
from ablebackup.als_parser import parse_als
from tests.helpers import write_als, fileref_abs


def test_parses_absolute_path_ref(tmp_path):
    als = write_als(tmp_path / "song.als", [
        fileref_abs("C:\\samples\\kick.wav", "kick.wav"),
        fileref_abs("/Users/me/snare.wav", "snare.wav"),
    ])
    refs = parse_als(als)
    assert len(refs) == 2
    assert refs[0].name == "kick.wav"
    assert refs[0].absolute_path == "C:\\samples\\kick.wav"
    assert refs[0].relative_path is None
    assert refs[1].absolute_path == "/Users/me/snare.wav"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_als_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup.als_parser'`

- [ ] **Step 3: Write minimal implementation**

`backend/ablebackup/als_parser.py`:
```python
import gzip
import defusedxml.ElementTree as ET   # safe against XXE / billion-laughs; .als is untrusted input
import xml.etree.ElementTree as _ET   # only for the Element type hint
from pathlib import Path

from ablebackup.models import FileRef


def _value_of(parent: _ET.Element, tag: str) -> str | None:
    child = parent.find(tag)
    if child is not None and "Value" in child.attrib:
        return child.attrib["Value"]
    return None


def _fileref_to_model(fileref: _ET.Element) -> FileRef:
    absolute = _value_of(fileref, "Path")
    name = _value_of(fileref, "Name") or ""
    return FileRef(name=name, absolute_path=absolute, relative_path=None)


def parse_als(als_path: Path) -> list[FileRef]:
    """Decompress an .als and return all file references it contains."""
    with gzip.open(als_path, "rt", encoding="utf-8") as fh:
        tree = ET.parse(fh)
    root = tree.getroot()
    return [_fileref_to_model(fr) for fr in root.iter("FileRef")]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_als_parser.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/als_parser.py backend/tests/test_als_parser.py
git commit -m "feat: parse absolute-path FileRefs from .als"
```

---

### Task 5: Parser — RelativePath (Value attribute) form

**Files:**
- Modify: `backend/ablebackup/als_parser.py`
- Test: `backend/tests/test_als_parser.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_als_parser.py`:
```python
from tests.helpers import fileref_rel


def test_parses_relative_path_value_ref(tmp_path):
    als = write_als(tmp_path / "song.als", [
        fileref_rel("Samples/Imported/loop.wav", "loop.wav"),
    ])
    refs = parse_als(als)
    assert len(refs) == 1
    assert refs[0].name == "loop.wav"
    assert refs[0].absolute_path is None
    assert refs[0].relative_path == "Samples/Imported/loop.wav"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_als_parser.py::test_parses_relative_path_value_ref -v`
Expected: FAIL — `relative_path` is `None` (parser doesn't read RelativePath yet)

- [ ] **Step 3: Write minimal implementation**

In `backend/ablebackup/als_parser.py`, replace `_fileref_to_model` with:
```python
def _relative_path(fileref: _ET.Element) -> str | None:
    rel = fileref.find("RelativePath")
    if rel is None:
        return None
    # Live 11/12: <RelativePath Value="Samples/Imported/loop.wav"/>
    if "Value" in rel.attrib and rel.attrib["Value"]:
        return rel.attrib["Value"]
    return None


def _fileref_to_model(fileref: _ET.Element) -> FileRef:
    absolute = _value_of(fileref, "Path")
    relative = _relative_path(fileref)
    name = _value_of(fileref, "Name") or ""
    return FileRef(name=name, absolute_path=absolute, relative_path=relative)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_als_parser.py -v`
Expected: PASS (both parser tests)

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/als_parser.py backend/tests/test_als_parser.py
git commit -m "feat: parse RelativePath Value FileRefs"
```

---

### Task 6: Parser — legacy RelativePathElement chain

**Files:**
- Modify: `backend/ablebackup/als_parser.py`
- Test: `backend/tests/test_als_parser.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_als_parser.py`:
```python
from tests.helpers import fileref_legacy


def test_parses_legacy_relative_path_element_chain(tmp_path):
    als = write_als(tmp_path / "song.als", [
        fileref_legacy(["Samples", "Imported"], "old.wav"),
    ])
    refs = parse_als(als)
    assert len(refs) == 1
    assert refs[0].name == "old.wav"
    assert refs[0].relative_path == "Samples/Imported/old.wav"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_als_parser.py::test_parses_legacy_relative_path_element_chain -v`
Expected: FAIL — `relative_path` is `None` (element-chain form not handled)

- [ ] **Step 3: Write minimal implementation**

In `backend/ablebackup/als_parser.py`, update `_relative_path` to also assemble the legacy chain
(the directory elements joined with the filename):
```python
def _relative_path(fileref: _ET.Element) -> str | None:
    rel = fileref.find("RelativePath")
    if rel is None:
        return None
    # Live 11/12: <RelativePath Value="Samples/Imported/loop.wav"/>
    if "Value" in rel.attrib and rel.attrib["Value"]:
        return rel.attrib["Value"]
    # Live 9/10: <RelativePathElement Dir="Samples"/> chain + separate <Name/>
    dirs = [
        e.attrib["Dir"]
        for e in rel.findall("RelativePathElement")
        if e.attrib.get("Dir")
    ]
    if not dirs:
        return None
    name = _value_of(fileref, "Name") or ""
    parts = dirs + ([name] if name else [])
    return "/".join(parts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_als_parser.py -v`
Expected: PASS (all three parser tests)

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/als_parser.py backend/tests/test_als_parser.py
git commit -m "feat: parse legacy RelativePathElement chains"
```

---

### Task 7: Resolver — turn FileRefs into ResolvedRefs

**Files:**
- Create: `backend/ablebackup/resolver.py`
- Test: `backend/tests/test_resolver.py`

Resolution picks the first existing candidate (absolute path, then `project_dir/relative_path`),
records existence, size, and whether the file lives inside the project folder. Missing files are
recorded (not fatal) so the caller can report them.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_resolver.py`:
```python
from pathlib import Path
from ablebackup.models import FileRef
from ablebackup.resolver import resolve_refs


def test_resolves_relative_inside_project(tmp_path):
    proj = tmp_path / "MySong Project"
    (proj / "Samples").mkdir(parents=True)
    f = proj / "Samples" / "loop.wav"
    f.write_bytes(b"abc")
    refs = [FileRef(name="loop.wav", relative_path="Samples/loop.wav")]

    resolved = resolve_refs(refs, project_dir=proj)

    assert len(resolved) == 1
    r = resolved[0]
    assert r.exists is True
    assert r.resolved_path == f
    assert r.inside_project is True
    assert r.size == 3


def test_resolves_absolute_outside_project(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    lib = tmp_path / "library"
    lib.mkdir()
    ext = lib / "kick.wav"
    ext.write_bytes(b"kickkick")
    refs = [FileRef(name="kick.wav", absolute_path=str(ext))]

    resolved = resolve_refs(refs, project_dir=proj)

    assert resolved[0].exists is True
    assert resolved[0].inside_project is False
    assert resolved[0].size == 8


def test_missing_ref_is_flagged_not_fatal(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    refs = [FileRef(name="gone.wav", relative_path="Samples/gone.wav")]

    resolved = resolve_refs(refs, project_dir=proj)

    assert resolved[0].exists is False
    assert resolved[0].resolved_path is None
    assert resolved[0].size == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_resolver.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup.resolver'`

- [ ] **Step 3: Write minimal implementation**

`backend/ablebackup/resolver.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_resolver.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/resolver.py backend/tests/test_resolver.py
git commit -m "feat: resolve FileRefs against the filesystem"
```

---

### Task 8: Scanner — discover projects in source folders

**Files:**
- Create: `backend/ablebackup/scanner.py`
- Test: `backend/tests/test_scanner.py`

Walks one or more source roots, finds `.als` files, skips Ableton's own `Backup` autosave folders
and the tool's own output (`AbletonBackups`), and returns a `ProjectScan` per project with refs
already resolved.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_scanner.py`:
```python
from ablebackup.scanner import scan_projects
from tests.helpers import write_als, fileref_rel


def test_finds_als_and_resolves_refs(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"xyz")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])

    results = scan_projects([tmp_path])

    assert len(results) == 1
    scan = results[0]
    assert scan.name == "Song"
    assert scan.project_dir == proj
    assert len(scan.refs) == 1
    assert scan.refs[0].exists is True


def test_skips_backup_and_output_folders(tmp_path):
    proj = tmp_path / "Song Project"
    backup = proj / "Backup"
    backup.mkdir(parents=True)
    write_als(backup / "Song [2023-01-01].als", [])
    out = tmp_path / "AbletonBackups" / "projects" / "Song" / "2026-01-01_1200"
    out.mkdir(parents=True)
    write_als(out / "Song.als", [])
    write_als(proj / "Song.als", [])

    results = scan_projects([tmp_path])

    assert len(results) == 1
    assert results[0].project_dir == proj
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_scanner.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup.scanner'`

- [ ] **Step 3: Write minimal implementation**

`backend/ablebackup/scanner.py`:
```python
import os
from pathlib import Path

from ablebackup.als_parser import parse_als
from ablebackup.models import ProjectScan
from ablebackup.resolver import resolve_refs

SKIP_DIRS = {"Backup", "AbletonBackups"}


def scan_projects(roots: list[Path]) -> list[ProjectScan]:
    projects: list[ProjectScan] = []
    for root in roots:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                if not fn.lower().endswith(".als"):
                    continue
                als_path = Path(dirpath) / fn
                project_dir = als_path.parent
                stat = als_path.stat()
                refs = resolve_refs(parse_als(als_path), project_dir)
                projects.append(ProjectScan(
                    als_path=als_path,
                    name=als_path.stem,
                    project_dir=project_dir,
                    mtime=stat.st_mtime,
                    size=stat.st_size,
                    refs=refs,
                ))
    return projects
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_scanner.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/scanner.py backend/tests/test_scanner.py
git commit -m "feat: scan source folders for Ableton projects"
```

---

### Task 9: Hashing — content hash of a file

**Files:**
- Create: `backend/ablebackup/hashing.py`
- Test: `backend/tests/test_hashing.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_hashing.py`:
```python
import hashlib
from ablebackup.hashing import hash_file


def test_hash_matches_hashlib(tmp_path):
    f = tmp_path / "a.bin"
    data = b"hello world" * 1000
    f.write_bytes(data)
    expected = hashlib.sha256(data).hexdigest()
    assert hash_file(f) == expected


def test_identical_content_same_hash(tmp_path):
    (tmp_path / "a").write_bytes(b"same")
    (tmp_path / "b").write_bytes(b"same")
    assert hash_file(tmp_path / "a") == hash_file(tmp_path / "b")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_hashing.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup.hashing'`

- [ ] **Step 3: Write minimal implementation**

`backend/ablebackup/hashing.py`:
```python
import hashlib
from pathlib import Path

_CHUNK = 1024 * 1024


def hash_file(path: Path) -> str:
    """Return the SHA-256 hex digest of a file's contents."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_hashing.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/hashing.py backend/tests/test_hashing.py
git commit -m "feat: add content hashing"
```

---

### Task 10: Catalog — SQLite history

**Files:**
- Create: `backend/ablebackup/catalog.py`
- Test: `backend/tests/test_catalog.py`

Records each snapshot and its missing refs for later browsing/reporting. Lives locally per
machine (default path passed in by the caller).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_catalog.py`:
```python
from ablebackup.catalog import Catalog


def test_record_and_read_snapshot(tmp_path):
    cat = Catalog(tmp_path / "catalog.db")
    sid = cat.record_snapshot(
        project_name="Song",
        timestamp="2026-06-06_1430",
        total_size=1234,
        file_count=10,
        status="ok",
        missing=["Samples/gone.wav"],
    )
    rows = cat.snapshots_for("Song")
    assert len(rows) == 1
    assert rows[0]["timestamp"] == "2026-06-06_1430"
    assert rows[0]["file_count"] == 10
    assert cat.missing_for(sid) == ["Samples/gone.wav"]
    cat.close()


def test_catalog_persists_across_instances(tmp_path):
    db = tmp_path / "catalog.db"
    c1 = Catalog(db)
    c1.record_snapshot("S", "t1", 1, 1, "ok", [])
    c1.close()
    c2 = Catalog(db)
    assert len(c2.snapshots_for("S")) == 1
    c2.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_catalog.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup.catalog'`

- [ ] **Step 3: Write minimal implementation**

`backend/ablebackup/catalog.py`:
```python
import sqlite3
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    total_size INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT
);
CREATE TABLE IF NOT EXISTS missing_refs (
    snapshot_id INTEGER NOT NULL,
    expected_path TEXT NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
);
"""


class Catalog:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)
        self.conn.commit()

    def record_snapshot(self, project_name, timestamp, total_size,
                        file_count, status, missing, error=None) -> int:
        cur = self.conn.execute(
            "INSERT INTO snapshots "
            "(project_name, timestamp, total_size, file_count, status, error) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (project_name, timestamp, total_size, file_count, status, error),
        )
        sid = cur.lastrowid
        self.conn.executemany(
            "INSERT INTO missing_refs (snapshot_id, expected_path) VALUES (?, ?)",
            [(sid, p) for p in missing],
        )
        self.conn.commit()
        return sid

    def snapshots_for(self, project_name) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM snapshots WHERE project_name = ? ORDER BY timestamp",
            (project_name,),
        ).fetchall()
        return [dict(r) for r in rows]

    def missing_for(self, snapshot_id) -> list[str]:
        rows = self.conn.execute(
            "SELECT expected_path FROM missing_refs WHERE snapshot_id = ?",
            (snapshot_id,),
        ).fetchall()
        return [r["expected_path"] for r in rows]

    def close(self):
        self.conn.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_catalog.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/catalog.py backend/tests/test_catalog.py
git commit -m "feat: add SQLite catalog for snapshot history"
```

---

### Task 11: Hardlink support detection

**Files:**
- Modify: `backend/ablebackup/backup_engine.py` (create file)
- Test: `backend/tests/test_backup_engine.py`

Some NAS filesystems/protocols don't support hardlinks. Detect at runtime by attempting a link in
the destination and falling back to copy.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_backup_engine.py`:
```python
from ablebackup.backup_engine import supports_hardlinks


def test_supports_hardlinks_true_on_tmp(tmp_path):
    # Local temp filesystems support hardlinks on all CI platforms we target.
    assert supports_hardlinks(tmp_path) is True


def test_detection_leaves_no_residue(tmp_path):
    supports_hardlinks(tmp_path)
    assert list(tmp_path.iterdir()) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_backup_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup.backup_engine'`

- [ ] **Step 3: Write minimal implementation**

`backend/ablebackup/backup_engine.py`:
```python
import os
from pathlib import Path


def supports_hardlinks(dest_dir: Path) -> bool:
    """Probe whether the destination filesystem supports hardlinks."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    src = dest_dir / ".hardlink_probe_src"
    dst = dest_dir / ".hardlink_probe_dst"
    try:
        src.write_bytes(b"probe")
        os.link(src, dst)
        return True
    except (OSError, NotImplementedError):
        return False
    finally:
        for p in (dst, src):
            try:
                p.unlink()
            except OSError:
                pass
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_backup_engine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/backup_engine.py backend/tests/test_backup_engine.py
git commit -m "feat: detect hardlink support on destination"
```

---

### Task 12: Backup engine — pooled, hardlinked, atomic snapshot

**Files:**
- Modify: `backend/ablebackup/backup_engine.py`
- Test: `backend/tests/test_backup_engine.py`

Writes one project to the destination as a dated snapshot. Each file is stored once in
`_pool/<hash>` and hardlinked (or copied) into
`projects/<ProjectName>/<timestamp>/<logical_path>`. The snapshot is built in a temp dir and
renamed into place last (atomic), with a `manifest.json` written before the rename. The logical
layout reproduces the project folder: the `.als` at the root, and each resolved ref at its path
relative to the project dir (external refs go under `_External/<name>`).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_backup_engine.py`:
```python
import json
from pathlib import Path
from ablebackup.backup_engine import backup_project
from ablebackup.scanner import scan_projects
from tests.helpers import write_als, fileref_rel, fileref_abs


def _make_project(tmp_path):
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    ext_lib = tmp_path / "lib"
    ext_lib.mkdir()
    (ext_lib / "kick.wav").write_bytes(b"kickdata")
    write_als(proj / "Song.als", [
        fileref_rel("Samples/loop.wav", "loop.wav"),
        fileref_abs(str(ext_lib / "kick.wav"), "kick.wav"),
    ])
    return scan_projects([proj])[0]


def test_backup_creates_self_contained_snapshot(tmp_path):
    scan = _make_project(tmp_path)
    dest = tmp_path / "NAS" / "AbletonBackups"

    result = backup_project(scan, dest, timestamp="2026-06-06_1430")

    snap = dest / "projects" / "Song" / "2026-06-06_1430"
    assert (snap / "Song.als").exists()
    assert (snap / "Samples" / "loop.wav").read_bytes() == b"loopdata"
    assert (snap / "_External" / "kick.wav").read_bytes() == b"kickdata"
    manifest = json.loads((snap / "manifest.json").read_text())
    assert manifest["project_name"] == "Song"
    assert manifest["file_count"] == 3  # als + loop + kick
    assert result.file_count == 3
    assert result.missing == []


def test_second_backup_dedups_unchanged_files(tmp_path):
    scan = _make_project(tmp_path)
    dest = tmp_path / "NAS" / "AbletonBackups"
    backup_project(scan, dest, timestamp="2026-06-06_1430")

    # Re-scan and back up again at a new timestamp; pool must not grow.
    scan2 = scan_projects([scan.project_dir.parent])
    scan2 = [s for s in scan2 if s.name == "Song"][0]
    pool_before = {p.name for p in (dest / "_pool").rglob("*") if p.is_file()}
    backup_project(scan2, dest, timestamp="2026-06-06_1500")
    pool_after = {p.name for p in (dest / "_pool").rglob("*") if p.is_file()}

    assert pool_before == pool_after  # no new pool entries for unchanged files
    assert (dest / "projects" / "Song" / "2026-06-06_1500" / "Song.als").exists()


def test_missing_ref_recorded_not_fatal(tmp_path):
    proj = tmp_path / "Song Project"
    proj.mkdir(parents=True)
    write_als(proj / "Song.als", [fileref_rel("Samples/gone.wav", "gone.wav")])
    scan = scan_projects([proj])[0]
    dest = tmp_path / "NAS" / "AbletonBackups"

    result = backup_project(scan, dest, timestamp="2026-06-06_1430")

    assert result.missing == ["Samples/gone.wav"]
    assert (dest / "projects" / "Song" / "2026-06-06_1430" / "Song.als").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_backup_engine.py -v`
Expected: FAIL — `ImportError: cannot import name 'backup_project'`

- [ ] **Step 3: Write minimal implementation**

Append to `backend/ablebackup/backup_engine.py`:
```python
import json
import shutil
from dataclasses import dataclass

from ablebackup.hashing import hash_file
from ablebackup.models import ProjectScan


@dataclass
class BackupResult:
    project_name: str
    timestamp: str
    snapshot_dir: Path
    file_count: int
    total_size: int
    missing: list[str]


def _logical_path(scan: ProjectScan, ref) -> str:
    """Path of a resolved ref inside the snapshot folder (POSIX-style)."""
    if ref.inside_project:
        rel = ref.resolved_path.resolve().relative_to(scan.project_dir.resolve())
        return rel.as_posix()
    return f"_External/{ref.name}"


def _place(pool: Path, src: Path, dest_file: Path, use_hardlinks: bool) -> int:
    """Store src in the pool by hash and link/copy it to dest_file. Returns size."""
    digest = hash_file(src)
    pooled = pool / digest[:2] / digest
    if not pooled.exists():
        pooled.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, pooled)
    dest_file.parent.mkdir(parents=True, exist_ok=True)
    if use_hardlinks:
        os.link(pooled, dest_file)
    else:
        shutil.copy2(pooled, dest_file)
    return pooled.stat().st_size


def backup_project(scan: ProjectScan, dest_root: Path, timestamp: str) -> BackupResult:
    """Write one project to dest_root as a deduplicated dated snapshot."""
    pool = dest_root / "_pool"
    use_hardlinks = supports_hardlinks(dest_root)
    final_dir = dest_root / "projects" / scan.name / timestamp
    temp_dir = dest_root / "projects" / scan.name / f".{timestamp}.tmp"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)

    total_size = 0
    file_count = 0
    missing: list[str] = []

    # The .als itself.
    total_size += _place(pool, scan.als_path, temp_dir / scan.als_path.name, use_hardlinks)
    file_count += 1

    # Each resolved reference.
    for ref in scan.refs:
        if not ref.exists or ref.resolved_path is None:
            # Record the relative path we expected, for reporting.
            missing.append(_logical_path_for_missing(scan, ref))
            continue
        logical = _logical_path(scan, ref)
        total_size += _place(pool, ref.resolved_path, temp_dir / logical, use_hardlinks)
        file_count += 1

    manifest = {
        "project_name": scan.name,
        "timestamp": timestamp,
        "file_count": file_count,
        "total_size": total_size,
        "missing": missing,
        "used_hardlinks": use_hardlinks,
    }
    (temp_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    if final_dir.exists():
        shutil.rmtree(final_dir)
    temp_dir.rename(final_dir)

    return BackupResult(
        project_name=scan.name,
        timestamp=timestamp,
        snapshot_dir=final_dir,
        file_count=file_count,
        total_size=total_size,
        missing=missing,
    )


def _logical_path_for_missing(scan: ProjectScan, ref) -> str:
    """Best-effort expected path for a missing ref (for the report)."""
    return ref.name if "/" not in ref.name else ref.name
```

Note: missing refs only know their `name` after resolution fails, so the report uses the
parser's relative path when available. To preserve it, update the resolver call site is **not**
needed — instead adjust the test expectation. The test expects `"Samples/gone.wav"`, so we must
carry the expected relative path. Implement this by extending `ResolvedRef` usage: see Step 3b.

- [ ] **Step 3b: Carry the expected path for missing refs**

The cleanest fix is to record, on a missing `ResolvedRef`, the relative path the parser produced.
Update `backend/ablebackup/resolver.py` so the missing branch keeps the relative path in
`resolved_path`-adjacent reporting. Concretely, add an `expected_path` field.

In `backend/ablebackup/models.py`, add a field to `ResolvedRef`:
```python
@dataclass
class ResolvedRef:
    name: str
    resolved_path: Optional[Path]
    exists: bool
    inside_project: bool
    size: int = 0
    expected_path: Optional[str] = None   # relative path we looked for, when missing
```

In `backend/ablebackup/resolver.py`, set `expected_path` in the missing branch:
```python
        else:
            resolved.append(ResolvedRef(
                name=ref.name,
                resolved_path=None,
                exists=False,
                inside_project=False,
                size=0,
                expected_path=ref.relative_path or ref.absolute_path or ref.name,
            ))
```

In `backend/ablebackup/backup_engine.py`, replace `_logical_path_for_missing` usage with:
```python
        if not ref.exists or ref.resolved_path is None:
            missing.append(ref.expected_path or ref.name)
            continue
```
and delete the `_logical_path_for_missing` helper.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_backup_engine.py tests/test_resolver.py -v`
Expected: PASS (all backup-engine and resolver tests)

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/backup_engine.py backend/ablebackup/models.py backend/ablebackup/resolver.py backend/tests/test_backup_engine.py
git commit -m "feat: pooled hardlinked atomic project snapshots"
```

---

### Task 13: CLI driver — scan and backup end-to-end

**Files:**
- Create: `backend/ablebackup/cli.py`
- Test: `backend/tests/test_integration.py`

A small `argparse` CLI: `scan` lists discovered projects; `backup` snapshots them to the
destination and records history in the catalog. This makes the engine a usable standalone tool.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_integration.py`:
```python
import json
from pathlib import Path
from ablebackup.cli import run
from tests.helpers import write_als, fileref_rel


def _build_project(root: Path):
    proj = root / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    write_als(proj / "Song.als", [fileref_rel("Samples/loop.wav", "loop.wav")])


def test_cli_scan_lists_projects(tmp_path, capsys):
    _build_project(tmp_path)
    code = run(["scan", "--source", str(tmp_path)])
    out = capsys.readouterr().out
    assert code == 0
    assert "Song" in out
    assert "1 file" in out or "1 ref" in out


def test_cli_backup_then_dedup(tmp_path):
    _build_project(tmp_path)
    dest = tmp_path / "NAS"
    db = tmp_path / "catalog.db"

    code = run(["backup", "--source", str(tmp_path), "--dest", str(dest),
                "--db", str(db), "--timestamp", "2026-06-06_1430"])
    assert code == 0
    snap = dest / "AbletonBackups" / "projects" / "Song" / "2026-06-06_1430"
    assert (snap / "Song.als").exists()
    assert (snap / "Samples" / "loop.wav").exists()

    # Second run dedups: pool unchanged.
    pool = dest / "AbletonBackups" / "_pool"
    before = {p.name for p in pool.rglob("*") if p.is_file()}
    run(["backup", "--source", str(tmp_path), "--dest", str(dest),
         "--db", str(db), "--timestamp", "2026-06-06_1500"])
    after = {p.name for p in pool.rglob("*") if p.is_file()}
    assert before == after
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_integration.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ablebackup.cli'`

- [ ] **Step 3: Write minimal implementation**

`backend/ablebackup/cli.py`:
```python
import argparse
from datetime import datetime
from pathlib import Path

from ablebackup.backup_engine import backup_project
from ablebackup.catalog import Catalog
from ablebackup.scanner import scan_projects


def _default_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H%M")


def _cmd_scan(args) -> int:
    projects = scan_projects([Path(s) for s in args.source])
    for p in projects:
        present = sum(1 for r in p.refs if r.exists)
        miss = len(p.missing)
        print(f"{p.name}: {present} files, {miss} missing  ({p.project_dir})")
    print(f"{len(projects)} project(s) found")
    return 0


def _cmd_backup(args) -> int:
    dest_root = Path(args.dest) / "AbletonBackups"
    timestamp = args.timestamp or _default_timestamp()
    cat = Catalog(Path(args.db))
    projects = scan_projects([Path(s) for s in args.source])
    for p in projects:
        result = backup_project(p, dest_root, timestamp)
        cat.record_snapshot(
            project_name=result.project_name,
            timestamp=result.timestamp,
            total_size=result.total_size,
            file_count=result.file_count,
            status="ok",
            missing=result.missing,
        )
        print(f"backed up {result.project_name}: "
              f"{result.file_count} files, {len(result.missing)} missing")
    cat.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ablebackup")
    sub = parser.add_subparsers(dest="command", required=True)

    scan_p = sub.add_parser("scan", help="list discovered projects")
    scan_p.add_argument("--source", action="append", required=True)
    scan_p.set_defaults(func=_cmd_scan)

    backup_p = sub.add_parser("backup", help="back up projects to destination")
    backup_p.add_argument("--source", action="append", required=True)
    backup_p.add_argument("--dest", required=True)
    backup_p.add_argument("--db", required=True)
    backup_p.add_argument("--timestamp", default=None)
    backup_p.set_defaults(func=_cmd_backup)

    return parser


def run(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    import sys
    raise SystemExit(run(sys.argv[1:]))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_integration.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/ablebackup/cli.py backend/tests/test_integration.py
git commit -m "feat: add scan/backup CLI driver"
```

---

### Task 14: Full suite + README

**Files:**
- Create: `backend/README.md`
- Test: (whole suite)

- [ ] **Step 1: Run the full test suite**

Run: `cd backend && python -m pytest -v`
Expected: PASS — all tests across every module.

- [ ] **Step 2: Write the README**

`backend/README.md`:
```markdown
# ablebackup engine

Plan 1 of the Ableton Project Backup Tool: the standalone backup engine + CLI.

## Usage

    python -m ablebackup.cli scan --source "C:\Users\me\Music\Ableton"

    python -m ablebackup.cli backup \
        --source "C:\Users\me\Music\Ableton" \
        --dest "Z:\\" \
        --db "%LOCALAPPDATA%\ablebackup\catalog.db"

`scan` lists discovered projects and how many referenced files exist / are missing.
`backup` writes a deduplicated dated snapshot of every project under
`<dest>/AbletonBackups/projects/<Project>/<timestamp>/` and records history in the catalog DB.

## What it does / does not do

- Resolves every sample reference in each `.als` (relative + absolute, modern + legacy formats),
  copies the complete self-contained project, and flags any missing files.
- Dedups identical files across snapshots via a content pool + hardlinks (falls back to copies
  on filesystems without hardlink support).
- Does NOT back up plugins/VSTs (installed software). Does NOT render stems.

Next plans: FastAPI/scheduler layer, then the Electron + web UI.
```

- [ ] **Step 3: Commit**

```bash
git add backend/README.md
git commit -m "docs: backend engine usage README"
```

---

## Self-Review

**Spec coverage:**
- Scan + discovery → Task 8 (scanner). UI approve step is Plan 2/3.
- Resolve all deps incl. external, flag missing → Tasks 4–7 (parser + resolver).
- `.als` gunzip + XML, multiple Live versions → Tasks 4–6.
- Dedup + hardlink snapshots + fallback → Tasks 11–12.
- Date-organized snapshots (`projects/<name>/<timestamp>/`) → Task 12. Date-indexed *view* is a
  UI concern (Plan 3).
- Catalog/history → Task 10.
- Atomic snapshots, missing-not-fatal error handling → Task 12 tests.
- Cross-platform path handling → resolver normalizes separators (Task 7); hardlink detection
  (Task 11).
- Scheduler, FastAPI, Electron, frontend → explicitly deferred to Plans 2 and 3.

**Placeholder scan:** No TBD/TODO. Task 12 includes a Step 3b that reworks the missing-ref
reporting with full code; no vague instructions remain.

**Type consistency:** `FileRef(name, absolute_path, relative_path)`, `ResolvedRef(name,
resolved_path, exists, inside_project, size, expected_path)`, `ProjectScan(als_path, name,
project_dir, mtime, size, refs)`, `BackupResult(project_name, timestamp, snapshot_dir,
file_count, total_size, missing)`. `parse_als`, `resolve_refs`, `scan_projects`, `hash_file`,
`supports_hardlinks`, `backup_project`, `Catalog.record_snapshot/snapshots_for/missing_for`, and
`run(argv)` are used consistently across tasks.
