"""A song played off a NAS carries on through a network blip."""
import builtins

import pytest

from ablebackup import steadyplay


def _flaky(monkeypatch, fails_at: int, times: int):
    real = builtins.open
    left = {"n": times}

    class Flaky:
        def __init__(self, f):
            self.f = f

        def seek(self, n):
            self.f.seek(n)

        def read(self, n):
            if self.f.tell() >= fails_at and left["n"] > 0:
                left["n"] -= 1
                raise OSError(22, "Invalid argument")
            return self.f.read(n)

        def close(self):
            self.f.close()
    monkeypatch.setattr(steadyplay, "open", lambda p, m="r": Flaky(real(p, m)), raising=False)
    monkeypatch.setattr(steadyplay, "CHUNK", 1000)


def test_a_blip_mid_song_is_ridden_out(tmp_path, monkeypatch):
    song = tmp_path / "Night Drive.mp3"
    song.write_bytes(bytes(range(256)) * 40)
    _flaky(monkeypatch, fails_at=3000, times=2)
    got = b"".join(steadyplay._chunks(str(song), 0, song.stat().st_size - 1, pause=0))
    assert got == song.read_bytes()


def test_a_part_of_the_song_is_served_for_seeking(tmp_path, monkeypatch):
    song = tmp_path / "Night Drive.mp3"
    song.write_bytes(bytes(range(256)) * 40)
    r = steadyplay.response(str(song), "bytes=100-199", pause=0)
    assert r.status_code == 206 and r.headers["content-range"] == f"bytes 100-199/{256 * 40}"
    assert steadyplay.response(str(song), "bytes=999999-").status_code == 416
    _flaky(monkeypatch, fails_at=0, times=99)
    with pytest.raises(OSError):  # a NAS that's really gone still ends the song
        b"".join(steadyplay._chunks(str(song), 0, 10, pause=0))
