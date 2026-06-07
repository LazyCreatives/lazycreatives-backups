from pathlib import Path

from ablebackup.daws.registry import adapter_for_id, adapter_for_path, all_extensions


def test_registry_routes_als_to_ableton():
    a = adapter_for_path(Path("/music/Song Project/Song.als"))
    assert a is not None and a.daw_id == "ableton"
    assert adapter_for_id("ableton").display_name == "Ableton Live"
    assert ".als" in all_extensions()


def test_registry_returns_none_for_unknown_extension():
    assert adapter_for_path(Path("/music/song.logicx")) is None  # not supported
    assert adapter_for_id("nope") is None


def test_flstudio_registered():
    assert ".flp" in all_extensions()
    a = adapter_for_path(Path("/music/beat.flp"))
    assert a is not None and a.daw_id == "flstudio"
    assert adapter_for_id("flstudio").backup_root == "FLStudioBackups"
