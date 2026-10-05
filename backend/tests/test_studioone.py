"""Studio One adapter: a .song (zip of XML) is found, its audio is followed (also when
the song folder has moved), autosaves are not songs of their own, tempo/key/tracks/
plug-ins are read, and a backup verifies."""
import zipfile
from pathlib import Path

import pytest

from ablebackup.backup_engine import backup_project
from ablebackup.daws.registry import adapter_for_id, adapter_for_path
from ablebackup.daws.studioone import StudioOneAdapter, _url_to_path
from ablebackup.scanner import find_projects, find_projects_progress, scan_one, scan_projects
from ablebackup.verifier import verify_snapshot

# Shaped like what Studio One writes: a BOM, the undeclared x: prefix, tempo as
# seconds per beat (0.5 = 120 BPM; 0.48 = 125 BPM).
SONG_XML = """\ufeff<?xml version="1.0" encoding="UTF-8"?>
<Song>
  <Attributes x:id="Root" defaultTimeFormat="2" length="316">
    <Attributes x:id="timeContext" sampleRate="44100">
      <TempoMap x:id="tempoMap">
        <TempoMapSegment curveType="0" start="0" end="32" tempo="0.48"/>
        <TempoMapSegment curveType="0" start="32" end="1e200" tempo="1"/>
      </TempoMap>
    </Attributes>
    <List x:id="Tracks">
      <MarkerTrack name="Marker"/>
      <MediaTrack mediaType="Audio" name="Vox" trackID="{1}"/>
      <MediaTrack mediaType="Audio" name="Drums" trackID="{2}"/>
      <MediaTrack mediaType="Music" name="Keys" trackID="{3}"/>
      <ArrangerTrack timeFormat="2"/>
    </List>
  </Attributes>
</Song>"""

MIXER_XML = """<AudioMixer><Attributes x:id="channels"><ChannelGroup name="AudioTrack">
  <AudioTrackChannel label="Vox"><Attributes x:id="Inserts">
    <Attributes name="FX01"><Attributes x:id="deviceData" name="Pro EQ"/></Attributes>
    <Attributes name="FX02"><Attributes x:id="deviceData" name="FabFilter Pro-C 2"/></Attributes>
    <Attributes x:id="Presets" pname="default"/>
  </Attributes></AudioTrackChannel>
</ChannelGroup></Attributes></AudioMixer>"""


def _url(p: Path) -> str:
    return p.as_uri()


def make_song(folder: Path, name="Night Drive", media=(), extra_urls=(), key="A minor",
              recordings=("Vox 01.wav",)):
    """A song folder like Studio One makes: Name/Name.song with recordings in Media/."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "Media").mkdir(exist_ok=True)
    urls = []
    for r in recordings:
        f = folder / "Media" / r
        f.write_bytes(b"rec-" + r.encode())
        urls.append(_url(f))
    urls += [_url(Path(m)) for m in media] + list(extra_urls)
    clips = "".join(f'<AudioClip mediaID="{{C{i}}}"><Url x:id="path" type="1" url="{u}"/></AudioClip>'
                    for i, u in enumerate(urls))
    pool = (f'<MediaPool><Attributes x:id="rootFolder"><MediaFolder name="Audio">{clips}'
            '<MusicClip mediaID="{M}"><Url x:id="dataPath" type="1" '
            'url="media:///Performances/Keys/Keys(0).musicx"/></MusicClip>'
            '</MediaFolder></Attributes></MediaPool>')
    meta = (f'<MetaInformation><Attribute id="Document:Title" value="{name}"/>'
            '<Attribute id="Document:Generator" value="Studio One/7.1.0.12345"/>'
            f'<Attribute id="Media:KeySignature" value="{key}"/></MetaInformation>')
    song = folder / f"{name}.song"
    with zipfile.ZipFile(song, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("metainfo.xml", meta)
        z.writestr("Song/song.xml", SONG_XML)
        z.writestr("Song/mediapool.xml", pool)
        z.writestr("Devices/audiomixer.xml", MIXER_XML)
        z.writestr("Performances/Keys/Keys(0).musicx", b"{}")
    return song


def test_registered_by_extension():
    assert adapter_for_path("/Songs/Night Drive/Night Drive.song").daw_id == "studioone"
    assert adapter_for_id("studioone").display_name == "Studio One"


def test_scan_reads_tempo_key_tracks_plugins_and_recordings(tmp_path):
    song = make_song(tmp_path / "Songs" / "Night Drive")
    scan = scan_one(song)
    assert scan.daw_id == "studioone"
    assert scan.name == "Night Drive"
    assert scan.tempo == 125.0
    assert scan.track_count == 3             # marker and arranger lanes aren't tracks
    assert {r.name for r in scan.refs} == {"Vox 01.wav"}   # media:/// parts live inside
    assert not scan.missing
    assert all(r.inside_project for r in scan.refs)
    _, meta = StudioOneAdapter().parse_with_meta(song)
    assert meta["plugins"] == ["Pro EQ", "FabFilter Pro-C 2"]
    assert meta["key"] == "A minor"
    _, meta = StudioOneAdapter().parse_with_meta(make_song(tmp_path / "B", "B", key="-"))
    assert meta["key"] is None


def test_outside_audio_gathered_and_gone_audio_reported(tmp_path):
    ext = tmp_path / "Samples" / "kick.wav"
    ext.parent.mkdir()
    ext.write_bytes(b"kick")
    song = make_song(tmp_path / "Night Drive", media=[str(ext), str(tmp_path / "gone.wav")])
    scan = scan_one(song)
    assert {r.name for r in scan.refs if r.exists} == {"Vox 01.wav", "kick.wav"}
    assert [r.name for r in scan.missing] == ["gone.wav"]


def test_moved_song_folder_still_finds_its_recordings(tmp_path):
    old = make_song(tmp_path / "old drive" / "Night Drive")
    new_dir = tmp_path / "new drive" / "Night Drive"
    new_dir.parent.mkdir()
    old.parent.rename(new_dir)               # stored addresses now point nowhere
    scan = scan_one(new_dir / "Night Drive.song")
    assert not scan.missing
    assert [r.resolved_path for r in scan.refs] == [new_dir / "Media" / "Vox 01.wav"]


def test_history_autosaves_are_not_songs(tmp_path):
    song = make_song(tmp_path / "Night Drive")
    hist = song.parent / "History"
    hist.mkdir()
    (hist / "Night Drive (Autosaved).song").write_bytes(song.read_bytes())
    want = [song]
    assert StudioOneAdapter().discover_projects([tmp_path]) == want
    assert [p for p in find_projects([tmp_path]) if p.suffix == ".song"] == want
    assert find_projects_progress([tmp_path]) == want


def test_other_dot_song_files_are_skipped(tmp_path):
    (tmp_path / "ringtone.song").write_bytes(b"not a zip")
    with zipfile.ZipFile(tmp_path / "other.song", "w") as z:
        z.writestr("data.json", "{}")
    assert scan_projects([tmp_path]) == []


@pytest.mark.parametrize("url,path", [
    ("file:///C:/Users/Rob/Documents/Studio%20One/Songs/A/Media/Vox.wav",
     "C:/Users/Rob/Documents/Studio One/Songs/A/Media/Vox.wav"),
    ("file:///Users/rob/Music/A/Media/Vox 2.wav", "/Users/rob/Music/A/Media/Vox 2.wav"),
    ("file://NAS/music/kick.wav", "//NAS/music/kick.wav"),
    ("media:///Performances/Keys/Keys(0).musicx", None),
])
def test_file_addresses_from_windows_mac_and_shares(url, path):
    assert _url_to_path(url) == path


def test_windows_song_read_on_another_computer_relinks_by_folder(tmp_path):
    """A song made on Windows, opened from a copy of its folder elsewhere."""
    folder = tmp_path / "Night Drive"
    song = make_song(folder, recordings=(), extra_urls=[
        "file:///C:/Users/Rob/Documents/Studio%20One/Songs/Night%20Drive/Media/Bass.wav"])
    (folder / "Media" / "Bass.wav").write_bytes(b"bass")
    scan = scan_one(song)
    assert not scan.missing and [r.name for r in scan.refs] == ["Bass.wav"]


def test_backup_keeps_song_and_media_and_verifies(tmp_path):
    ext = tmp_path / "Samples" / "kick.wav"
    ext.parent.mkdir()
    ext.write_bytes(b"kick")
    song = make_song(tmp_path / "Songs" / "Night Drive", media=[str(ext)])
    scan = scan_one(song)
    res = backup_project(scan, tmp_path / "dest", "2026-10-05_1300", portable=True)
    snap = res.snapshot_dir
    assert (snap / "Night Drive.song").read_bytes() == song.read_bytes()
    assert (snap / "Media" / "Vox 01.wav").is_file()
    assert (snap / "_External" / "kick.wav").is_file()
    v = verify_snapshot(snap)
    assert v["ok"], v


def test_scan_projects_mixes_studio_one_with_other_daws(tmp_path):
    make_song(tmp_path / "Night Drive")
    (tmp_path / "beat.rpp").write_text("<REAPER_PROJECT\n>\n")
    got = {(p.name, p.daw_id) for p in scan_projects([tmp_path])}
    assert ("Night Drive", "studioone") in got
    assert ("beat", "reaper") in got
