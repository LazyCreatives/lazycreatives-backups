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


def test_dedupes_repeated_sample_refs(tmp_path):
    # One sample triggered by several clips -> several identical FileRefs; count once.
    proj = tmp_path / "proj"
    proj.mkdir()
    ext = tmp_path / "kick.wav"
    ext.write_bytes(b"kick")
    refs = [FileRef(name="kick.wav", absolute_path=str(ext))] * 3

    resolved = resolve_refs(refs, project_dir=proj)

    assert len(resolved) == 1
    assert resolved[0].size == 4


def test_relinks_missing_ref_via_locator(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    # The project points at a sample that no longer exists there...
    refs = [FileRef(name="kick.wav", absolute_path="/old/place/kick.wav")]
    # ...but a copy lives in the user's library.
    lib = tmp_path / "Splice"
    lib.mkdir()
    (lib / "kick.wav").write_bytes(b"kickkick")
    from ablebackup.locator import make_locator
    locate = make_locator([lib])

    # without a locator -> missing
    assert resolve_refs(refs, project_dir=proj)[0].exists is False
    # with a locator -> found and relinked
    r = resolve_refs(refs, project_dir=proj, locate=locate)[0]
    assert r.exists is True
    assert r.relinked is True
    assert r.resolved_path == lib / "kick.wav"


def test_dedupes_repeated_missing_refs(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    refs = [FileRef(name="gone.wav", relative_path="Samples/gone.wav")] * 4

    resolved = resolve_refs(refs, project_dir=proj)

    assert len(resolved) == 1
    assert resolved[0].exists is False
