"""Audacity adapter: .aup3 (self-contained SQLite) and legacy .aup (+_data folder,
alias externals). Backups must verify; corruption must be caught."""
import sqlite3

from ablebackup.backup_engine import backup_project
from ablebackup.daws.audacity import AudacityAdapter
from ablebackup.scanner import scan_one
from ablebackup.verifier import verify_snapshot


def _make_aup3(path):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE project (id INTEGER, dict BLOB, doc BLOB)")
    conn.execute("CREATE TABLE sampleblocks (blockid INTEGER PRIMARY KEY, samples BLOB)")
    conn.execute("INSERT INTO sampleblocks (samples) VALUES (x'00112233')")
    conn.commit()
    conn.close()
    return path


_AUP_XML = """<?xml version="1.0" standalone="no" ?>
<project xmlns="http://audacity.sourceforge.net/xml/" projname="Song_data" version="1.3.0" rate="44100.0">
  <wavetrack name="Track 1" channel="0" rate="44100">
    <waveclip offset="0.0">
      <sequence maxsamples="262144" numsamples="1000">
        <waveblock start="0">
          <simpleblockfile filename="e0000abc.au" len="1000" min="-1" max="1" rms="0.5"/>
        </waveblock>
      </sequence>
    </waveclip>
  </wavetrack>
  <wavetrack name="Track 2" channel="1" rate="44100">
    <waveclip offset="0.0">
      <sequence maxsamples="262144" numsamples="1000">
        <waveblock start="0">
          <pcmaliasblockfile summaryfile="e0000def.auf" aliasfile="{alias}" aliasstart="0" aliaslen="1000" aliaschannel="0" min="-1" max="1" rms="0.5"/>
        </waveblock>
      </sequence>
    </waveclip>
  </wavetrack>
</project>
"""


def _make_aup_project(tmp_path, alias_path):
    proj = tmp_path / "SongFolder"
    blocks = proj / "Song_data" / "e00" / "d00"
    blocks.mkdir(parents=True)
    (blocks / "e0000abc.au").write_bytes(b"au-block-data")
    (blocks.parent.parent / "e00" / "d00" / "e0000def.auf").write_bytes(b"summary")
    aup = proj / "Song.aup"
    aup.write_text(_AUP_XML.replace("{alias}", str(alias_path)))
    return aup


def test_aup3_scan_backup_verify_roundtrip(tmp_path):
    proj = tmp_path / "Podcast"
    proj.mkdir()
    _make_aup3(proj / "Episode.aup3")
    scan = scan_one(proj / "Episode.aup3")
    assert scan.daw_id == "audacity" and scan.refs == []
    res = backup_project(scan, tmp_path / "NAS" / "AudacityBackups", "t", portable=True)
    out = verify_snapshot(res.snapshot_dir, deep=True)
    assert out["ok"] and out["portable_ok"] is True  # self-contained by design


def test_aup3_corruption_is_rejected(tmp_path):
    proj = tmp_path / "Podcast"
    proj.mkdir()
    bad = proj / "Broken.aup3"
    bad.write_bytes(b"definitely not sqlite")
    adapter = AudacityAdapter()
    try:
        adapter.parse_project(bad)
        assert False, "corrupt .aup3 must raise"
    except ValueError:
        pass


def test_legacy_aup_backs_up_data_folder_and_alias(tmp_path):
    alias = tmp_path / "external" / "interview.wav"
    alias.parent.mkdir()
    alias.write_bytes(b"alias-audio-bytes")
    aup = _make_aup_project(tmp_path, alias)

    scan = scan_one(aup)
    assert scan.daw_id == "audacity"
    assert scan.track_count == 2
    by_name = {r.name: r for r in scan.refs}
    assert by_name["e0000abc.au"].exists and by_name["e0000abc.au"].inside_project
    assert by_name["interview.wav"].exists and not by_name["interview.wav"].inside_project

    res = backup_project(scan, tmp_path / "NAS" / "AudacityBackups", "t", portable=True)
    out = verify_snapshot(res.snapshot_dir, deep=True)
    assert out["ok"], out
    # block files keep their _data layout; the alias is gathered to _External
    assert (res.snapshot_dir / "Song_data" / "e00" / "d00" / "e0000abc.au").is_file()
    assert (res.snapshot_dir / "_External" / "interview.wav").is_file()


def test_legacy_aup_missing_block_is_reported(tmp_path):
    aup = _make_aup_project(tmp_path, tmp_path / "nowhere.wav")
    # delete a block the XML names
    (aup.parent / "Song_data" / "e00" / "d00" / "e0000abc.au").unlink()
    scan = scan_one(aup)
    missing = {r.name for r in scan.missing}
    assert "e0000abc.au" in missing and "nowhere.wav" in missing
