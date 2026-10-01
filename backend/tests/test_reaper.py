_RPP = """<REAPER_PROJECT 0.1 "7.0"
  <TRACK
    <ITEM
      <SOURCE WAVE
        FILE "Audio/kick.wav"
      >
    >
    <ITEM
      <SOURCE FLAC
        FILE "/Users/me/Splice/snare.flac"
      >
    >
    <ITEM
      <SOURCE WAVE
        FILE "Audio/kick.wav"
      >
    >
  >
  RENDER_FILE "/Users/me/renders/mixdown.wav"
>
"""


def test_reader_extracts_sources_not_render_target(tmp_path):
    from ablebackup.daws.reaper import read_sample_paths
    rpp = tmp_path / "song.rpp"
    rpp.write_text(_RPP)
    paths = read_sample_paths(rpp)
    assert paths == ["Audio/kick.wav", "/Users/me/Splice/snare.flac"]  # deduped, no RENDER_FILE


def test_adapter_splits_relative_and_absolute(tmp_path):
    from ablebackup.daws.reaper import ReaperAdapter
    rpp = tmp_path / "song.rpp"
    rpp.write_text(_RPP)
    refs = ReaperAdapter().parse_project(rpp)
    by_name = {r.name: r for r in refs}
    assert by_name["kick.wav"].relative_path == "Audio/kick.wav"
    assert by_name["kick.wav"].absolute_path is None
    assert by_name["snare.flac"].absolute_path == "/Users/me/Splice/snare.flac"


def test_scan_one_dispatches_rpp(tmp_path):
    from ablebackup.scanner import scan_one
    proj = tmp_path / "Song"
    (proj / "Audio").mkdir(parents=True)
    (proj / "Audio" / "kick.wav").write_bytes(b"audio")
    rpp = proj / "Song.rpp"
    rpp.write_text('<REAPER_PROJECT\n<SOURCE WAVE\nFILE "Audio/kick.wav"\n>\n>\n')

    scan = scan_one(rpp)
    assert scan.daw_id == "reaper"
    assert sum(1 for r in scan.refs if r.exists) == 1
