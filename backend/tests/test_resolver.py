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
