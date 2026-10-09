"""Smarter song matching: name clues, stems, spelling slips backed by save times,
old project names, songs you linked by hand, title tags, and the list of songs no
project matched (with a suggested project)."""
import os
import struct
from pathlib import Path

from fastapi.testclient import TestClient

from ablebackup import audiotags, exports
from ablebackup.api.app import create_app
from ablebackup.catalog import Catalog
from ablebackup.songmatch import is_stem

H = 3600.0
T0 = 1_780_000_000.0  # some afternoon in 2026


def _touch(p: Path, data: bytes = b"RIFF0000WAVE", mtime: float | None = None) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    if mtime is not None:
        os.utime(p, (mtime, mtime))
    return p


def _project(cat: Catalog, pid: str, name: str, d: Path, mtime: float = 1.0):
    d.mkdir(parents=True, exist_ok=True)
    cat.upsert_discovered([{"project_id": pid, "name": name, "path": str(d / f"{name}.als"),
                            "dir": str(d), "daw": "ableton", "owner": "me", "size": 1,
                            "mtime": mtime, "missing_count": 0}], "2026-10-01_1200")


def _setup(tmp_path):
    cat = Catalog(tmp_path / "c.db")
    shared = tmp_path / "NEW EXPORTS AIFS:MP3S"
    shared.mkdir()
    cat.set_setting("export_folders", [str(shared)])
    return cat, shared


def _rows(cat, pid):
    return {e["name"]: e for e in cat.exports_for(pid)}


# ---- name cleaning ---------------------------------------------------------------
def test_dates_tempos_keys_and_zeros_are_left_out():
    n = exports.normalize
    assert n("2026-10-01 Night Drive.wav") == "night drive"
    assert n("Night Drive 07.10.26.wav") == "night drive"
    assert n("Night_Drive_20261001.wav") == "night drive"
    assert n("Night Drive 124bpm Amin.wav") == "night drive"
    assert n("Night Drive 124 BPM F#m.mp3") == "night drive"
    assert n("Night Drive C minor.wav") == "night drive"
    assert n("Night Drive.opus") == "night drive"
    assert exports.normalize_keep_numbers("Freaky_02.wav") == "freaky 2"
    # words that only look like keys stay
    assert n("I Am.wav") == "i am"
    assert n("Night Drive Ebm.wav") == "night drive"


def test_artist_in_front_words_run_together_and_numbering(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "nd", "Night Drive", tmp_path / "p" / "Night Drive Project")
    _project(cat, "f", "Freaky", tmp_path / "p" / "Freaky Project")
    _project(cat, "f2", "Freaky 2", tmp_path / "p" / "Freaky 2 Project")
    _touch(shared / "Robert - Night Drive.wav")
    _touch(shared / "01 Night Drive (club).wav")
    _touch(shared / "NightDrive_master.wav")
    _touch(shared / "Freaky_02.wav")
    _touch(shared / "Night Drive.wav")
    exports.refresh(cat)
    nd = _rows(cat, "nd")
    assert set(nd) == {"Robert - Night Drive", "01 Night Drive (club)", "NightDrive_master",
                       "Night Drive"}
    assert nd["Night Drive"]["sure"] == 1 and nd["Night Drive"]["why"] == "name matches this project"
    assert nd["Robert - Night Drive"]["sure"] == 0
    assert "spaces" in nd["NightDrive_master"]["why"]
    assert list(_rows(cat, "f2")) == ["Freaky_02"]
    assert _rows(cat, "f") == {}


def test_name_that_merely_starts_like_a_project_is_not_glued_on(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "s", "Sunset", tmp_path / "p" / "Sunset Project")
    _touch(shared / "Sunsets are nice.wav")
    exports.refresh(cat)
    assert _rows(cat, "s") == {}
    assert [u["name"] for u in cat.unmatched()] == ["Sunsets are nice"]


# ---- stems ---------------------------------------------------------------------
def test_stems_are_told_apart_from_songs(tmp_path):
    assert is_stem(Path("/x/Night Drive Kick.wav"), project="Night Drive")
    assert is_stem(Path("/x/Night Drive 3-Bass.wav"), project="Night Drive")
    assert is_stem(Path("/x/Night Drive (Stems) Vocals.wav"), project="Night Drive")
    assert is_stem(Path("/x/Stems/Anything.wav"), root=Path("/x"))
    assert not is_stem(Path("/x/Night Drive.wav"), project="Night Drive")
    assert not is_stem(Path("/x/Night Drive Bass Edit.wav"), project="Night Drive")
    assert not is_stem(Path("/x/Bass Odyssey.wav"), project="Bass Odyssey")
    assert not is_stem(Path("/x/Night Drive Instrumental.wav"), project="Night Drive")


def test_stems_listed_under_their_song_but_not_as_the_latest_song(tmp_path):
    cat, shared = _setup(tmp_path)
    d = tmp_path / "p" / "Night Drive Project"
    _project(cat, "nd", "Night Drive", d)
    _touch(d / "Night Drive.wav", mtime=T0)
    _touch(d / "Stems" / "Kick.wav", mtime=T0 + 60)              # inside the project folder
    _touch(shared / "Night Drive Vocals.wav", mtime=T0 + 120)    # name + a part
    _touch(shared / "Night Drive Stems" / "Bass.wav", mtime=T0 + 180)  # a stems folder
    exports.refresh(cat)
    nd = _rows(cat, "nd")
    assert {k: v["kind"] for k, v in nd.items()} == {
        "Night Drive": "song", "Kick": "stem", "Night Drive Vocals": "stem", "Bass": "stem"}
    assert "stems folder" in nd["Bass"]["why"]
    assert cat.latest_exports()["nd"] == {"count": 1, "latest": cat.latest_exports()["nd"]["latest"]}
    assert cat.latest_exports()["nd"]["latest"]["name"] == "Night Drive"


# ---- dates ---------------------------------------------------------------------
def test_a_slip_of_spelling_counts_when_exported_right_after_a_save(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "nd", "Night Drive", tmp_path / "p" / "Night Drive Project", mtime=T0)
    _project(cat, "lo", "Lost Signal", tmp_path / "p" / "Lost Signal Project", mtime=T0 - 30 * 24 * H)
    _touch(shared / "Nigt Drive.wav", mtime=T0 + 20 * 60)          # 20 minutes after the save
    _touch(shared / "Lost Signul.wav", mtime=T0)                   # a month after: only a suggestion
    exports.refresh(cat)
    nd = _rows(cat, "nd")
    assert list(nd) == ["Nigt Drive"] and nd["Nigt Drive"]["sure"] == 0
    assert "20 minutes after" in nd["Nigt Drive"]["why"]
    [u] = cat.unmatched()
    assert u["name"] == "Lost Signul" and u["suggest_id"] == "lo"
    assert "spelled almost like" in u["suggest_why"]


def test_unnamed_render_suggests_the_project_saved_just_before(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "a", "Alpha", tmp_path / "p" / "A", mtime=T0)
    _project(cat, "b", "Bravo", tmp_path / "p" / "B", mtime=T0 + 5 * H)
    _project(cat, "c", "Charlie", tmp_path / "p" / "C", mtime=T0 + 5 * H + 300)
    _touch(shared / "Untitled 4.wav", mtime=T0 + 10 * 60)         # 10 min after Alpha
    _touch(shared / "Untitled 5.wav", mtime=T0 + 5 * H + 400)     # Bravo and Charlie both: no guess
    exports.refresh(cat)
    got = {u["name"]: u for u in cat.unmatched()}
    assert got["Untitled 4"]["suggest_id"] == "a"
    assert got["Untitled 4"]["suggest_why"] == "exported 10 minutes after this project was saved"
    assert got["Untitled 5"]["suggest_id"] is None
    assert all(_rows(cat, p) == {} for p in "abc")  # a date alone never links a song


def test_same_name_projects_use_every_known_save(tmp_path):
    """The older project was last saved long ago, but a backup shows it was worked
    on the day the song was exported."""
    cat, shared = _setup(tmp_path)
    for pid, mtime in (("old", T0 - 90 * 24 * H), ("new", T0 + 60 * 24 * H)):
        _project(cat, pid, "Idea", tmp_path / pid, mtime=mtime)
    cat.record_snapshot("Idea", "2026-05-28_1400", 1, 1, "ok", [], project_id="old",
                        dir=str(tmp_path / "old"))
    ts = exports.snapshot_time("2026-05-28_1400")
    _touch(shared / "Idea.wav", mtime=ts - 30 * 60)
    exports.refresh(cat)
    assert list(_rows(cat, "old")) == ["Idea"]
    assert _rows(cat, "new") == {}


# ---- old names, learning from you ----------------------------------------------
def test_songs_from_before_a_rename_still_match(tmp_path):
    cat, shared = _setup(tmp_path)
    d = tmp_path / "p" / "Night Drive Project"
    _project(cat, "nd2", "Night Drive", d)
    # backed up when the project file was still called "Midnight Idea"
    cat.record_snapshot("Midnight Idea", "2026-09-01_2200", 1, 1, "ok", [], project_id="nd1",
                        dir=str(d))
    _touch(shared / "Midnight Idea master.wav")
    exports.refresh(cat)
    row = _rows(cat, "nd2")["Midnight Idea master"]
    assert row["sure"] == 0 and "old name" in row["why"] and "Midnight Idea" in row["why"]


def test_learns_from_songs_you_link_and_dismiss(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "nd", "Night Drive", tmp_path / "p" / "Night Drive Project")
    _project(cat, "su", "Sunrise", tmp_path / "p" / "Sunrise Project")
    a = _touch(shared / "Late Bus edit.wav")
    _touch(shared / "Late Bus edit v2.wav")
    s = _touch(shared / "Sunrise Kick.wav")
    _touch(shared / "Sunrise Kick 2.wav")
    _touch(shared / "Untitled.wav")
    _touch(shared / "Untitled 3.wav")
    exports.refresh(cat)
    cat.link_export(str(a.resolve()), "nd", a.stem, 1, 1)
    cat.link_export(str((shared / "Untitled.wav").resolve()), "nd", "Untitled", 1, 1)
    cat.hide_export(str(s.resolve()), "su")
    exports.refresh(cat)
    assert set(_rows(cat, "nd")) == {"Late Bus edit", "Late Bus edit v2", "Untitled"}
    assert "you added" in _rows(cat, "nd")["Late Bus edit v2"]["why"]
    assert _rows(cat, "su") == {}  # "Sunrise Kick 2" is named like one you said isn't from it
    waiting = {u["name"] for u in cat.unmatched()}
    assert {"Untitled 3", "Sunrise Kick 2"} <= waiting and "Late Bus edit v2" not in waiting


# ---- title tags ----------------------------------------------------------------
def _id3(title: str) -> bytes:
    body = b"\x03" + title.encode()
    frame = b"TIT2" + len(body).to_bytes(4, "big") + b"\x00\x00" + body
    size = len(frame)
    ss = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3\x03\x00\x00" + ss + frame + b"\xff\xfb" + b"\x00" * 64


def _wav_info(title: str) -> bytes:
    nam = title.encode() + b"\x00"
    if len(nam) & 1:
        nam += b"\x00"
    info = b"INFO" + b"INAM" + struct.pack("<I", len(nam)) + nam
    fmt = b"fmt " + struct.pack("<I", 16) + b"\x01\x00\x02\x00" + b"\x44\xac\x00\x00" * 2 + b"\x04\x00\x10\x00"
    body = b"WAVE" + fmt + b"LIST" + struct.pack("<I", len(info)) + info
    return b"RIFF" + struct.pack("<I", len(body)) + body


def _flac(title: str) -> bytes:
    vendor = b"x"
    entry = f"TITLE={title}".encode()
    vc = struct.pack("<I", len(vendor)) + vendor + struct.pack("<I", 1) + struct.pack("<I", len(entry)) + entry
    streaminfo = b"\x00" + (34).to_bytes(3, "big") + b"\x00" * 34
    return b"fLaC" + streaminfo + bytes([0x84]) + len(vc).to_bytes(3, "big") + vc


def _m4a(title: str) -> bytes:
    def atom(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", 8 + len(body)) + kind + body
    data = atom(b"data", b"\x00\x00\x00\x01" + b"\x00\x00\x00\x00" + title.encode())
    meta = atom(b"meta", b"\x00\x00\x00\x00" + atom(b"hdlr", b"\x00" * 25) + atom(b"ilst", atom(b"\xa9nam", data)))
    return atom(b"ftyp", b"M4A \x00\x00\x00\x00") + atom(b"moov", atom(b"udta", meta))


def test_reads_titles_inside_files(tmp_path):
    assert audiotags.title(_touch(tmp_path / "a.mp3", _id3("Night Drive"))) == "Night Drive"
    assert audiotags.title(_touch(tmp_path / "b.wav", _wav_info("Lost Signal"))) == "Lost Signal"
    assert audiotags.title(_touch(tmp_path / "c.flac", _flac("Sunrise"))) == "Sunrise"
    assert audiotags.title(_touch(tmp_path / "d.m4a", _m4a("Deep"))) == "Deep"
    assert audiotags.title(_touch(tmp_path / "e.wav", b"RIFF0000WAVE")) is None
    assert audiotags.title(_touch(tmp_path / "f.mp3", b"\x00" * 10)) is None


def test_a_title_tag_links_a_song_named_something_else(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "nd", "Night Drive", tmp_path / "p" / "Night Drive Project")
    _touch(shared / "track 7.mp3", _id3("Night Drive (Extended)"))
    exports.refresh(cat)
    row = _rows(cat, "nd")["track 7"]
    assert row["sure"] == 0 and "title saved inside the file" in row["why"]


# ---- the list of songs waiting for a project -------------------------------------
def test_api_unmatched_list_link_and_not_a_song(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "a", "Alpha", tmp_path / "p" / "A", mtime=T0)
    f = _touch(shared / "Mystery.wav", mtime=T0 + 600)
    g = _touch(shared / "Voice memo.wav", mtime=T0 - 40 * 24 * H)
    cat.close()
    app = create_app(token="t", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        h = {"X-Auth-Token": "t"}
        c.post("/api/exports/refresh", headers=h)
        for _ in range(100):
            if not c.get("/api/exports/status", headers=h).json()["running"]:
                break
        got = c.get("/api/exports/unmatched", headers=h).json()
        assert [s["name"] for s in got["songs"]] == ["Mystery", "Voice memo"]
        assert got["songs"][0]["suggest_id"] == "a" and got["songs"][0]["exists"]
        assert c.get("/api/library", headers=h).json()["unmatched_songs"] == 2
        # it can be played before deciding
        mystery = got["songs"][0]["path"]
        assert c.get("/api/exports/audio", params={"path": mystery, "t": "t"}).status_code == 200
        # one click links it; it leaves the list
        assert c.post("/api/exports/link", headers=h,
                      json={"path": str(f), "project_id": "a"}).json() == {"ok": True}
        # "not a song" hides it, and survives a re-check; undo brings it back
        voice = got["songs"][1]["path"]
        assert c.post("/api/exports/ignore", headers=h, json={"path": voice}).json() == {"ok": True}
        c.post("/api/exports/refresh", headers=h)
        for _ in range(100):
            if not c.get("/api/exports/status", headers=h).json()["running"]:
                break
        assert c.get("/api/exports/unmatched", headers=h).json()["songs"] == []
        assert [s["name"] for s in c.get("/api/exports/unmatched", headers=h,
                                         params={"ignored": True}).json()["songs"]] == ["Voice memo"]
        c.post("/api/exports/ignore", headers=h, json={"path": voice, "ignored": False})
        assert c.get("/api/exports/unmatched", headers=h).json()["count"] == 1
        assert c.post("/api/exports/ignore", headers=h, json={"path": "/nope.wav"}).status_code == 404
        # the linked one learned from: shows on the project, marked as added by you
        rows = c.get("/api/exports", headers=h, params={"project_id": "a"}).json()["exports"]
        assert [(r["name"], r["why"], r["sure"]) for r in rows] == [("Mystery", "added by you", 1)]
    assert g.exists()


def test_old_catalog_gets_the_new_columns(tmp_path):
    import sqlite3
    db = tmp_path / "old.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE exports (path TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL,"
        " size INTEGER, mtime REAL, match TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,"
        " PRIMARY KEY (path, project_id));"
        "INSERT INTO exports VALUES ('/a.wav', 'p', 'a', 1, 1, 'name', 0);")
    con.commit()
    con.close()
    cat = Catalog(db)
    [row] = cat.exports_for("p")
    assert row["kind"] == "song" and row["sure"] == 1


# ---- what the project file itself says ---------------------------------------------
def _reaper(cat, pid, name, d: Path, render_file: str, pattern: str):
    d.mkdir(parents=True, exist_ok=True)
    rpp = d / f"{name}.rpp"
    rpp.write_text(f'<REAPER_PROJECT 0.1 "7.0"\n  RENDER_FILE "{render_file}"\n'
                   f'  RENDER_PATTERN "{pattern}"\n  TEMPO 120 4 4\n>\n')
    cat.upsert_discovered([{"project_id": pid, "name": name, "path": str(rpp), "dir": str(d),
                            "daw": "reaper", "owner": "me", "size": 1, "mtime": 1.0,
                            "missing_count": 0}], "t")
    return rpp


def test_reaper_says_where_it_renders_and_what_it_calls_them(tmp_path):
    from ablebackup.songmatch import reaper_render
    cat = Catalog(tmp_path / "c.db")
    renders = tmp_path / "My Renders"
    rpp = _reaper(cat, "r1", "Grooves", tmp_path / "Grooves", str(renders), "$project - Robert mix $date")
    assert reaper_render(rpp, "Grooves") == (renders, "Grooves - Robert mix")
    _touch(renders / "Grooves - Robert mix 2026-10-05.wav")   # nobody told Backups about this folder
    exports.refresh(cat)
    row = _rows(cat, "r1")["Grooves - Robert mix 2026-10-05"]
    assert row["sure"] == 1 and "Reaper" in row["why"]
    # renders to its own folder under its own name: nothing extra to learn
    rpp2 = _reaper(cat, "r2", "Plain", tmp_path / "Plain", "", "")
    assert reaper_render(rpp2, "Plain") is None
    # a relative folder is inside the project's folder
    rpp3 = _reaper(cat, "r3", "Rel", tmp_path / "Rel", "Renders", "")
    assert reaper_render(rpp3, "Rel") == (tmp_path / "Rel" / "Renders", "Rel")


def test_logic_bounces_folder_is_looked_in(tmp_path, monkeypatch):
    monkeypatch.setenv("ABLEBACKUP_FIND_EXPORT_FOLDERS", "1")
    home = tmp_path / "home"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    cat = Catalog(tmp_path / "c.db")
    _project(cat, "lg", "Big Room", tmp_path / "Music" / "Big Room.logicx")
    _touch(home / "Music" / "Logic" / "Bounces" / "Big Room.wav")
    exports.refresh(cat)
    assert list(_rows(cat, "lg")) == ["Big Room"]
    assert str((home / "Music" / "Logic" / "Bounces").resolve()) in cat.get_setting("found_export_folders")


# ---- shared words, best guesses, samples (Robert's exports, 8 Oct) -----------------
def _wav_secs(p: Path, secs: float, mtime: float | None = None) -> Path:
    """A real (silent) WAV header saying the sound lasts ``secs``; the data itself is
    left out, only the length in the header counts."""
    rate, align = 1000, 2
    size = int(secs * rate * align)
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * align, align, 16)
    data = b"RIFF" + struct.pack("<I", 36 + size) + b"WAVE" + b"fmt " + struct.pack("<I", 16) \
        + fmt + b"data" + struct.pack("<I", size)
    return _touch(p, data, mtime)


def test_a_project_name_anywhere_in_the_song_name_links_it(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "w", "140 Wobs", tmp_path / "p" / "W")
    _project(cat, "a", "Aby Doors Bass arrangement", tmp_path / "p" / "A")
    _project(cat, "s", "Just Serum", tmp_path / "p" / "S")
    _touch(shared / "BREAKS 140 WOBS.aif")
    _touch(shared / "Aby Doors Bass.mp3")
    _touch(shared / "JUST SERUM 2 LMAO.mp3")
    exports.refresh(cat)
    assert "BREAKS 140 WOBS" in _rows(cat, "w")
    assert _rows(cat, "w")["BREAKS 140 WOBS"]["sure"] == 0
    assert "Aby Doors Bass" in _rows(cat, "a")
    assert "JUST SERUM 2 LMAO" in _rows(cat, "s")
    assert cat.unmatched() == []


def test_unmatched_songs_get_best_guesses_by_shared_words(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "l", "Launch Door Tune", tmp_path / "p" / "L")
    _project(cat, "b", "BASS DROP 3", tmp_path / "p" / "B")
    _project(cat, "x", "aphex twin", tmp_path / "p" / "X")
    _touch(shared / "LAUNCH ABY DOORS BASS.wav")
    exports.refresh(cat)
    [u] = cat.unmatched()
    ids = [g["project_id"] for g in u["guesses"]]
    assert ids[0] == "l" and "x" not in ids
    assert "launch door" in u["guesses"][0]["why"]
    assert u["suggest_id"] == "l"


def test_typo_and_cut_short_words_still_share(tmp_path):
    from ablebackup.songmatch import shared_words
    assert shared_words("mixx type beat", "mix type beat")[0] > 0.8
    assert shared_words("breaks 140 wobs", "wob breaks")[0] > 0.6
    assert shared_words("just serum 2", "aphex twin")[0] == 0
    assert shared_words("type beat", "dark type beat")[0] < 0.5  # plain words count little


def test_samples_and_resamples_sit_apart(tmp_path):
    cat, shared = _setup(tmp_path)
    _touch(shared / "Splice" / "packs" / "Atlanta" / "OS_ATL_kick_subby.wav")
    _touch(shared / "OS_6IX_kick_lavish.wav")
    _touch(shared / "1-Audio 0001 [2026-10-08 195233].aif")
    _wav_secs(shared / "bounce thing.wav", 4)
    _wav_secs(shared / "THE PENTHOUSE EXPERIMENT.wav", 200)
    exports.refresh(cat)
    got = {u["name"]: u for u in cat.unmatched()}
    assert got["THE PENTHOUSE EXPERIMENT"]["kind"] == "song"
    for n in ("OS_ATL_kick_subby", "OS_6IX_kick_lavish", "1-Audio 0001 [2026-10-08 195233]",
              "bounce thing"):
        assert got[n]["kind"] == "sample", n
    assert got["bounce thing"]["suggest_why"] == "only 4 seconds long"


def test_library_counts_each_song_once_and_leaves_out_samples(tmp_path):
    cat, shared = _setup(tmp_path)
    _touch(shared / "mixx type beat.aif")
    _touch(shared / "mixx type beat.mp3")
    _touch(shared / "OS_ATL_kick_subby.wav")
    exports.refresh(cat)
    cat.close() if hasattr(cat, "close") else None
    app = create_app(token="t", db_path=tmp_path / "c.db")
    with TestClient(app) as c:
        assert c.get("/api/library", headers={"X-Auth-Token": "t"}).json()["unmatched_songs"] == 1


def test_every_word_of_a_project_in_any_order_links_it(tmp_path):
    cat, shared = _setup(tmp_path)
    _project(cat, "w", "Wobs 140", tmp_path / "p" / "W")
    _touch(shared / "BREAKS 140 WOBS.aif")
    exports.refresh(cat)
    assert "BREAKS 140 WOBS" in _rows(cat, "w")
