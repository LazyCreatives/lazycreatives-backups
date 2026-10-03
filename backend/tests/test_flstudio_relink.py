"""FL Studio samples the project stores at an old or network path, but that are on
this computer: Backups must find them (a user's FL played them while Backups said
"Not found anywhere"). The stored paths mirror that report: \\\\BLUB_PC\\Users\\..."""
import gzip
from pathlib import Path

import pytest

from tests.test_flstudio import _make_flp

UNC = "\\\\BLUB_PC\\Users\\blub\\Downloads\\SOUTHSIDE Kit\\SOUTHSIDE_149_hihat_barbecue_alt.wav"
UNC_KICK = "\\\\BLUB_PC\\Users\\blub\\Desktop\\ZEN_EMH_kick.wav"


@pytest.fixture
def home(tmp_path, monkeypatch):
    h = tmp_path / "home"
    h.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: h))
    return h


def _project(tmp_path, paths):
    proj = tmp_path / "projects" / "2 minute beat lmao"
    proj.mkdir(parents=True)
    flp = proj / "2 minute beat lmao.flp"
    flp.write_bytes(_make_flp(paths))
    return flp


def _put(path: Path, data=b"RIFFwav") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def test_network_share_path_to_own_home_folder_is_found(tmp_path, home):
    from ablebackup.scanner import scan_one
    real = _put(home / "Downloads" / "SOUTHSIDE Kit" / "SOUTHSIDE_149_hihat_barbecue_alt.wav")
    scan = scan_one(_project(tmp_path, [UNC]))
    assert scan.missing == []
    assert scan.refs[0].resolved_path == real
    assert scan.refs[0].relinked is True


def test_sample_name_is_read_from_windows_paths_on_any_computer(tmp_path):
    from ablebackup.daws.flstudio import FlStudioAdapter
    refs = FlStudioAdapter().parse_project(_project(tmp_path, [UNC, "C:\\packs\\snare.wav"]))
    assert [r.name for r in refs] == ["SOUTHSIDE_149_hihat_barbecue_alt.wav", "snare.wav"]
    assert refs[0].absolute_path == UNC          # a network path is not relative


def test_fix_now_finds_moved_sample_by_name_like_fl_does(tmp_path, home):
    # The kick now lives in a sample folder with a different layout. FL finds it by
    # file name in its search folders; Fix now must find the same file.
    from ablebackup.locator import make_locator
    from ablebackup.scanner import scan_one
    lib = tmp_path / "Samples"
    real = _put(lib / "Drums" / "ZEN_EMH_kick.wav")
    flp = _project(tmp_path, [UNC_KICK])
    assert [r.name for r in scan_one(flp).missing] == ["ZEN_EMH_kick.wav"]
    scan = scan_one(flp, locate=make_locator([lib]))
    assert scan.missing == []
    assert scan.refs[0].resolved_path == real and scan.refs[0].relinked


def test_two_same_named_files_is_a_guess_and_stays_missing(tmp_path, home):
    from ablebackup.locator import make_locator
    from ablebackup.scanner import scan_one
    lib = tmp_path / "Samples"
    _put(lib / "A" / "ZEN_EMH_kick.wav")
    _put(lib / "B" / "ZEN_EMH_kick.wav", b"other")
    scan = scan_one(_project(tmp_path, [UNC_KICK]), locate=make_locator([lib]))
    assert [r.name for r in scan.missing] == ["ZEN_EMH_kick.wav"]


def test_fl_data_folder_is_searched_by_fix_now(tmp_path, home):
    from ablebackup.scanner import scan_one
    from ablebackup.service import _build_locator
    real = _put(home / "Documents" / "Image-Line" / "FL Studio" / "Audio" / "Sliced audio"
                / "ZEN_EMH_kick.wav")
    scan = scan_one(_project(tmp_path, [UNC_KICK]), locate=_build_locator([], []))
    assert scan.refs[0].resolved_path == real


def test_portable_copy_points_at_the_found_file(tmp_path, home):
    from ablebackup.daws.flp import read_sample_paths
    from ablebackup.daws.flstudio import FlStudioAdapter
    real = _put(home / "Downloads" / "SOUTHSIDE Kit" / "SOUTHSIDE_149_hihat_barbecue_alt.wav")
    flp = _project(tmp_path, [UNC])
    data = FlStudioAdapter().rewrite_portable(flp, {str(real): "_External/hihat.wav"})
    out = tmp_path / "out.flp"
    out.write_bytes(data)
    assert read_sample_paths(out) == ["_External/hihat.wav"]


# Ableton keeps the stricter rules: it records each sample's size, which must agree,
# and a lone same-named file is never enough on its own.

def _als_ref(path: str, size: int):
    from ablebackup.models import FileRef
    return FileRef(name=Path(path).name, absolute_path=path, size=size)


def test_ableton_sample_under_home_must_match_recorded_size(tmp_path, home):
    from ablebackup.resolver import resolve_refs
    _put(home / "Samples" / "kick.wav", b"12345")
    good = resolve_refs([_als_ref("/Users/olduser/Samples/kick.wav", 5)], tmp_path)
    assert good[0].exists and good[0].relinked
    bad = resolve_refs([_als_ref("/Users/olduser/Samples/kick.wav", 99)], tmp_path)
    assert not bad[0].exists


def test_ableton_never_relinks_on_name_alone(tmp_path, home):
    from ablebackup.locator import make_locator
    from ablebackup.models import FileRef
    from ablebackup.resolver import resolve_refs
    lib = tmp_path / "lib"
    _put(lib / "Elsewhere" / "kick.wav")
    ref = FileRef(name="kick.wav", absolute_path="/gone/Drums/kick.wav")  # no size
    out = resolve_refs([ref], tmp_path, locate=make_locator([lib]))
    assert not out[0].exists
