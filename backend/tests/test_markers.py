"""Project markers (locators and cues) for the song waveform: Ableton, REAPER and
DAWproject, and the /api/project/markers endpoint."""
import gzip
import zipfile

from fastapi.testclient import TestClient

from ablebackup.api.app import create_app
from ablebackup.markers import read_markers

_ALS = """<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5"><LiveSet>
<MainTrack><DeviceChain><Mixer><Tempo><Manual Value="120"/></Tempo></Mixer></DeviceChain></MainTrack>
<Locators><Locators>
  <Locator Id="1"><LomId Value="0"/><Time Value="64"/><Name Value="Drop"/><Annotation Value=""/></Locator>
  <Locator Id="0"><LomId Value="0"/><Time Value="0"/><Name Value="Intro"/><Annotation Value=""/></Locator>
</Locators></Locators>
</LiveSet></Ableton>"""


def test_ableton_locators_in_seconds(tmp_path):
    p = tmp_path / "song.als"
    p.write_bytes(gzip.compress(_ALS.encode()))
    # 64 beats at 120 BPM = 32 seconds; sorted by time
    assert read_markers(p) == [{"t": 0.0, "name": "Intro"}, {"t": 32.0, "name": "Drop"}]


def test_reaper_markers_and_regions_once(tmp_path):
    p = tmp_path / "song.rpp"
    p.write_text('<REAPER_PROJECT 0.1\n  TEMPO 128 4 4\n'
                 '  MARKER 1 12.5 "Big drop" 0\n'
                 '  MARKER 2 40 Verse 1\n  MARKER 2 70 "" 1\n'
                 '  MARKER 3 not-a-number x 0\n>\n')
    assert read_markers(p) == [{"t": 12.5, "name": "Big drop"}, {"t": 40.0, "name": "Verse"}]


def test_dawproject_markers_beats_to_seconds(tmp_path):
    p = tmp_path / "song.dawproject"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("project.xml", '<Project><Transport><Tempo value="90"/></Transport>'
                   '<Arrangement><Markers><Marker time="12" name="Hook"/></Markers></Arrangement></Project>')
    assert read_markers(p) == [{"t": 8.0, "name": "Hook"}]


def test_unknown_or_broken_files_have_none(tmp_path):
    bad = tmp_path / "song.als"
    bad.write_bytes(b"not gzip")
    assert read_markers(bad) == []
    assert read_markers(tmp_path / "song.flp") == []


def test_endpoint_reads_library_projects_only(tmp_path):
    p = tmp_path / "A.als"
    p.write_bytes(gzip.compress(_ALS.encode()))
    c = TestClient(create_app(token="", db_path=tmp_path / "c.db"))
    c.app.state.catalog.upsert_discovered([
        {"project_id": "p1", "name": "A", "path": str(p), "dir": str(tmp_path),
         "daw": "ableton", "owner": "ann", "size": 1, "mtime": 1.0, "missing_count": 0},
    ], "2026-06-09-1000")
    r = c.get("/api/project/markers", params={"path": str(p)})
    assert r.status_code == 200
    assert [m["name"] for m in r.json()["markers"]] == ["Intro", "Drop"]
    assert c.get("/api/project/markers", params={"path": str(tmp_path / "other.als")}).status_code == 404
