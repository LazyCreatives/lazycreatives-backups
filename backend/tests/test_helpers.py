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
