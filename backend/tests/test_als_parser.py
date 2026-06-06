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
