"""Regression tests for issues found running against real Ableton projects."""
from ablebackup.models import FileRef
from ablebackup.resolver import resolve_refs
from ablebackup.scanner import scan_projects
from ablebackup.backup_engine import backup_project
from tests.helpers import write_als, fileref_rel


def test_directory_reference_is_not_resolved_as_file(tmp_path):
    # A reference can resolve to a directory (e.g. an Ableton built-in device
    # bundle). It must NOT be treated as a present, backable file.
    proj = tmp_path / "proj"
    (proj / "Samples" / "bundle").mkdir(parents=True)
    refs = [FileRef(name="bundle", relative_path="Samples/bundle")]

    resolved = resolve_refs(refs, project_dir=proj)

    assert resolved[0].exists is False
    assert resolved[0].resolved_path is None


def test_backup_does_not_crash_on_directory_reference(tmp_path):
    # Real-world: a project references a built-in device directory alongside a
    # real sample. The backup must still succeed for the sample, and record the
    # directory reference as missing rather than raising IsADirectoryError.
    proj = tmp_path / "Song Project"
    (proj / "Samples").mkdir(parents=True)
    (proj / "Samples" / "loop.wav").write_bytes(b"loopdata")
    (proj / "Samples" / "bundle").mkdir()  # directory referenced like a file
    write_als(proj / "Song.als", [
        fileref_rel("Samples/loop.wav", "loop.wav"),
        fileref_rel("Samples/bundle", "bundle"),
    ])
    scan = scan_projects([proj])[0]
    dest = tmp_path / "NAS" / "AbletonBackups"

    result = backup_project(scan, dest, timestamp="t1")

    assert (dest / "projects" / "Song" / "t1" / "Samples" / "loop.wav").exists()
    assert "Samples/bundle" in result.missing
    assert result.file_count == 2  # als + loop.wav (the directory ref is skipped)
