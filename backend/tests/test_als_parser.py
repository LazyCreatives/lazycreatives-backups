from ablebackup.als_parser import parse_als
from tests.helpers import write_als, fileref_abs, fileref_rel


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


def test_parses_relative_path_value_ref(tmp_path):
    als = write_als(tmp_path / "song.als", [
        fileref_rel("Samples/Imported/loop.wav", "loop.wav"),
    ])
    refs = parse_als(als)
    assert len(refs) == 1
    assert refs[0].name == "loop.wav"
    assert refs[0].absolute_path is None
    assert refs[0].relative_path == "Samples/Imported/loop.wav"


from tests.helpers import fileref_legacy


def test_parses_legacy_relative_path_element_chain(tmp_path):
    als = write_als(tmp_path / "song.als", [
        fileref_legacy(["Samples", "Imported"], "old.wav"),
    ])
    refs = parse_als(als)
    assert len(refs) == 1
    assert refs[0].name == "old.wav"
    assert refs[0].relative_path == "Samples/Imported/old.wav"


def test_ignores_factory_and_device_filerefs(tmp_path):
    # FileRefs not wrapped in <SampleRef> are devices / factory presets that ship
    # with Ableton (Simpler, .adv presets, cached plugin presets) — not samples.
    als = write_als(tmp_path / "song.als", [
        fileref_abs("/Users/me/kick.wav", "kick.wav"),
        '<FileRef><Path Value="/Applications/Ableton Live 12 Suite.app/Contents/'
        'App-Resources/Builtin/Devices/Instruments/Simpler"/></FileRef>',
        '<FileRef><Path Value="/Users/me/Library/Caches/Ableton/Presets/'
        'AudioUnits/Kickstart 2/Default.aupreset"/></FileRef>',
    ])
    refs = parse_als(als)
    assert len(refs) == 1
    assert refs[0].name == "kick.wav"


def test_includes_video_but_not_devices(tmp_path):
    als = write_als(tmp_path / "song.als", [
        fileref_abs("/Users/me/kick.wav", "kick.wav"),  # SampleRef audio
        '<FileRef><Path Value="/Applications/Ableton Live 12 Suite.app/'
        'Contents/App-Resources/Builtin/Devices/Instruments/Simpler"/></FileRef>',
        '<VideoClip><FileRef><Path Value="/Users/me/scene.mov"/></FileRef></VideoClip>',
    ])
    paths = {r.absolute_path for r in parse_als(als)}
    assert "/Users/me/kick.wav" in paths    # audio kept
    assert "/Users/me/scene.mov" in paths   # video kept
    assert not any(p and "Simpler" in p for p in paths)  # device still excluded
