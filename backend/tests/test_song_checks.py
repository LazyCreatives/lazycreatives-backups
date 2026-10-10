"""Album songs: will each one play anywhere (DJ gear, USB sticks, club systems), and
using a newer export in a song's place. Files are only ever read.
The same tests run in Backups and Uploader (only the package name differs)."""
import array
import hashlib
import math
import struct
import wave
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ablebackup import songcheck
from ablebackup.albums import Albums, check_song
from ablebackup.albums_api import make_router


def _wav(path: Path, *, level: float = 0.5, seconds: float = 2, rate: int = 44100, width: int = 2) -> Path:
    """A stereo sine wave; a level over 1 is cut off at full level, like a clipped master."""
    path.parent.mkdir(parents=True, exist_ok=True)
    top = 2 ** (8 * width - 1) - 1
    frames = array.array("h" if width == 2 else "i")
    for i in range(int(rate * seconds)):
        v = max(-top, min(top, int(level * top * math.sin(2 * math.pi * 220 * i / rate))))
        frames.extend((v, v))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(frames.tobytes())
    return path


def _float_wav(path: Path, level: float, seconds: float = 2, rate: int = 44100) -> Path:
    """A 32-bit float WAV, which can go over full level."""
    path.parent.mkdir(parents=True, exist_ok=True)
    n = int(rate * seconds)
    data = b"".join(struct.pack("<ff", s, s) for s in
                    (level * math.sin(2 * math.pi * 220 * i / rate) for i in range(n)))
    fmt = struct.pack("<HHIIHH", 3, 2, rate, rate * 8, 8, 32)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)
    return path


def _digest(folder: Path):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob("*")) if p.is_file()}


def test_a_good_master_plays_anywhere(tmp_path):
    info = songcheck.measure(str(_wav(tmp_path / "Good.wav", level=0.9)))
    assert songcheck.summary(info) == "WAV · 16-bit · 44.1 kHz"
    assert info["lufs"] > -18
    assert songcheck.judge(info) == []


def test_what_dj_gear_wont_like(tmp_path):
    words = lambda info: " | ".join(p["what"] for p in songcheck.judge(info))  # noqa: E731
    assert "Clips" in words(songcheck.measure(str(_wav(tmp_path / "Hot.wav", level=1.6))))
    over = songcheck.measure(str(_float_wav(tmp_path / "Over.wav", level=1.5)))
    assert songcheck.summary(over) == "WAV · 32-bit float · 44.1 kHz"
    assert "32-bit float" in words(over) and "over full level" in words(over)
    assert "Quiet" in words(songcheck.measure(str(_wav(tmp_path / "Quiet.wav", level=0.02))))
    assert "96 kHz" in words(songcheck.measure(str(_wav(tmp_path / "Hi.wav", level=0.9, rate=96000, seconds=1))))


def test_rules_from_what_was_measured():
    loud = {"lufs": -8.0, "peak_db": -0.3, "flat": 0.0, "true_peak_db": -0.2, "rate": 44100, "channels": 2}
    whats = lambda **kw: [p["what"] for p in songcheck.judge({**loud, **kw})]  # noqa: E731
    assert whats(codec="mp3", kbps=320) == []
    assert whats(codec="mp3", kbps=192) == ["MP3 at 192 kbps. DJs and club systems expect 320."]
    assert whats(codec="pcm_s24le", bits=24, ext=".aiff") == []
    assert whats(codec="flac", bits=24)[0].startswith("FLAC.")
    assert whats(codec="vorbis")[0] == "Ogg. CDJs can't play it."
    assert whats(codec="pcm_s16le", bits=16, ext=".wav", channels=6) == ["6 channels. DJ gear plays stereo only."]
    assert whats(codec="pcm_s16le", bits=16, ext=".wav", true_peak_db=1.8)[0].startswith("Peaks at +1.8 dB")
    assert songcheck.summary({"codec": "mp3", "kbps": 320, "rate": 44100, "channels": 2}) == "MP3 · 320 kbps · 44.1 kHz"


def test_each_file_is_read_once_and_never_changed(tmp_path, monkeypatch):
    song = _wav(tmp_path / "Mixes" / "Good.wav", level=0.9)
    store = Albums()
    calls = []
    real = songcheck.measure
    monkeypatch.setattr(songcheck, "measure", lambda p: calls.append(p) or real(p))
    first = check_song(store, str(song))
    assert first["state"] == "ok" and first["summary"].startswith("WAV")
    assert check_song(store, str(song)) == first and len(calls) == 1   # kept with the album list
    _wav(song, level=1.6)                                               # exported again, now clipped
    before = _digest(tmp_path / "Mixes")
    again = check_song(store, str(song))
    assert again["state"] == "check" and len(calls) == 2
    assert _digest(tmp_path / "Mixes") == before
    assert check_song(store, str(tmp_path / "Gone.wav"))["state"] == "missing"


def test_checks_only_songs_on_an_album_and_swap_in_a_newer_export(tmp_path):
    old = _wav(tmp_path / "Mixes" / "Night Drive.wav", level=0.9)
    new = _wav(tmp_path / "Mixes" / "Night Drive v2.wav", level=0.8)
    stray = _wav(tmp_path / "Elsewhere" / "Secret.wav")
    before = _digest(tmp_path / "Mixes")
    app = FastAPI()
    app.include_router(make_router(lambda: None, lambda: None, lambda: []))
    c = TestClient(app)
    a = c.post("/api/albums", json={"title": "EP"}).json()
    a = c.post(f"/api/albums/{a['id']}/songs", json={"songs": [{"path": str(old), "title": "Night Drive"}]}).json()
    c.put(f"/api/albums/{a['id']}/song", json={"path": str(old), "ready": True, "gapless_after": True})

    assert c.get("/api/albums/check", params={"path": str(old)}).json()["state"] == "ok"
    assert c.get("/api/albums/check", params={"path": str(stray)}).status_code == 404

    a = c.put(f"/api/albums/{a['id']}/swap", json={"path": str(old), "new_path": str(new)}).json()
    s = a["songs"][0]
    assert s["path"] == str(new) and s["title"] == "Night Drive" and s["gapless_after"] is True
    assert s["ready"] is None                     # a new file: the app judges it again
    assert c.put(f"/api/albums/{a['id']}/swap", json={"path": str(old), "new_path": str(new)}).status_code == 409
    assert _digest(tmp_path / "Mixes") == before


def test_where_the_album_is_on_soundcloud_is_shared():
    store = Albums()
    a = store.create("EP")
    rev = store.rev()
    store.set_soundcloud(a["id"], {"playlist_id": 7, "url": "https://soundcloud.com/me/sets/ep"})
    assert store.rev() > rev
    assert store.get(a["id"])["soundcloud"]["playlist_id"] == 7
    assert store.set_soundcloud(a["id"], None)["soundcloud"] is None


def test_what_you_call_the_album_is_kept_and_shared():
    app = FastAPI()
    app.include_router(make_router(lambda: None, lambda: None, lambda: []))
    c = TestClient(app)
    a = c.post("/api/albums", json={"title": "Night Drive"}).json()
    assert a["kind"] == ""                          # goes by its length until you pick
    assert c.put(f"/api/albums/{a['id']}", json={"kind": "LP"}).json()["kind"] == "LP"
    assert Albums().get(a["id"])["kind"] == "LP"    # the other app sees it too
    assert c.put(f"/api/albums/{a['id']}", json={"kind": "boxset"}).status_code == 422
    assert c.put(f"/api/albums/{a['id']}", json={"kind": ""}).json()["kind"] == ""
