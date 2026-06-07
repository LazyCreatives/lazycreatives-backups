import json

from ablebackup.service import snapshot_diff


def _manifest(d, files):
    d.mkdir(parents=True, exist_ok=True)
    (d / "manifest.json").write_text(json.dumps({"files": files}))
    return d


def test_diff_detects_added_removed_changed_unchanged(tmp_path):
    old = _manifest(tmp_path / "old", [
        {"logical_path": "Song.als", "digest": "aaa"},
        {"logical_path": "Samples/kick.wav", "digest": "k1"},
        {"logical_path": "Samples/old.wav", "digest": "o1"},
    ])
    new = _manifest(tmp_path / "new", [
        {"logical_path": "Song.als", "digest": "bbb"},          # changed
        {"logical_path": "Samples/kick.wav", "digest": "k1"},   # unchanged
        {"logical_path": "Samples/new.wav", "digest": "n1"},    # added
    ])  # old.wav removed
    d = snapshot_diff(new, old)
    assert d["available"] is True
    assert d["added"] == ["Samples/new.wav"]
    assert d["removed"] == ["Samples/old.wav"]
    assert d["changed"] == ["Song.als"]
    assert d["unchanged"] == 1


def test_diff_first_backup_is_all_added(tmp_path):
    new = _manifest(tmp_path / "new", [{"logical_path": "Song.als", "digest": "a"}])
    d = snapshot_diff(new, None)
    assert d["added"] == ["Song.als"]
    assert d["removed"] == [] and d["changed"] == [] and d["unchanged"] == 0
