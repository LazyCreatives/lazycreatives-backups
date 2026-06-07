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


def test_relinks_missing_ref_by_recorded_size(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    lib = tmp_path / "Splice"
    lib.mkdir()
    (lib / "kick.wav").write_bytes(b"kickkick")  # 8 bytes
    from ablebackup.locator import make_locator
    locate = make_locator([lib])
    # the project recorded this sample as 8 bytes -> the library copy matches
    refs = [FileRef(name="kick.wav", absolute_path="/old/place/kick.wav", size=8)]

    assert resolve_refs(refs, project_dir=proj)[0].exists is False  # no locator
    r = resolve_refs(refs, project_dir=proj, locate=locate)[0]
    assert r.exists is True and r.relinked is True
    assert r.resolved_path == lib / "kick.wav"


def test_does_not_relink_wrong_sized_same_named_file(tmp_path):
    # The dangerous case: a DIFFERENT sample shares the filename. It must NOT be
    # silently backed up in place of the real one.
    proj = tmp_path / "proj"
    proj.mkdir()
    lib = tmp_path / "Splice"
    lib.mkdir()
    (lib / "kick.wav").write_bytes(b"a-totally-different-kick")  # 24 bytes
    from ablebackup.locator import make_locator
    locate = make_locator([lib])
    refs = [FileRef(name="kick.wav", absolute_path="/old/place/kick.wav", size=8)]

    r = resolve_refs(refs, project_dir=proj, locate=locate)[0]
    assert r.exists is False  # refused to relink the wrong file
    assert r.relinked is False


def test_relinks_by_path_tail_when_size_unknown(tmp_path):
    # Older projects may not record a size; require a strong path-tail match instead.
    proj = tmp_path / "proj"
    proj.mkdir()
    lib = tmp_path / "lib" / "Drums" / "Kicks"
    lib.mkdir(parents=True)
    (lib / "kick.wav").write_bytes(b"x")
    from ablebackup.locator import make_locator
    locate = make_locator([tmp_path / "lib"])
    refs = [FileRef(name="kick.wav", relative_path="Drums/Kicks/kick.wav", size=0)]

    r = resolve_refs(refs, project_dir=proj, locate=locate)[0]
    assert r.exists is True and r.relinked is True


def test_dedupes_repeated_missing_refs(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    refs = [FileRef(name="gone.wav", relative_path="Samples/gone.wav")] * 4

    resolved = resolve_refs(refs, project_dir=proj)

    assert len(resolved) == 1
    assert resolved[0].exists is False
