"""The in-app player: files Chromium can't read are decoded in memory, never on disk."""
import math
import os
import struct
import wave

import pytest

from ablebackup import playback

needs_ffmpeg = pytest.mark.skipif(not playback.ffmpeg(), reason="no ffmpeg here")


def _frames(n=4410):
    return b"".join(struct.pack("<hh", v, v) for v in
                    (int(8000 * math.sin(i / 10)) for i in range(n)))


def _wav16(path):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2), w.setsampwidth(2), w.setframerate(44100)
        w.writeframes(_frames())
    return path


def _wav_header(path, tag, bits):
    """A WAV whose 'fmt ' chunk says `tag` / `bits` (enough for the format check)."""
    fmt = struct.pack("<HHIIHH", tag, 2, 44100, 44100 * 2 * bits // 8, 2 * bits // 8, bits)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", 0)
    path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)
    return path


def _ext_float(x):  # 80-bit float, as AIFF stores its sample rate
    e = int(math.floor(math.log2(x)))
    return struct.pack(">HQ", e + 16383, int(x * 2 ** (63 - e)))


def _aiff16(path):
    data = b"".join(struct.pack(">hh", v, v) for v in (int(8000 * math.sin(i / 10)) for i in range(4410)))
    comm = struct.pack(">hIh", 2, 4410, 16) + _ext_float(44100)
    ssnd = struct.pack(">II", 0, 0) + data
    body = (b"AIFF" + b"COMM" + struct.pack(">I", len(comm)) + comm
            + b"SSND" + struct.pack(">I", len(ssnd)) + ssnd)
    path.write_bytes(b"FORM" + struct.pack(">I", len(body)) + body)
    return path


def test_what_plays_as_it_is(tmp_path):
    assert playback.native(str(_wav16(tmp_path / "a.wav")))
    assert playback.native(str(_wav_header(tmp_path / "f32.wav", 3, 32)))
    assert playback.native(str(_wav_header(tmp_path / "s24.wav", 1, 24)))
    assert not playback.native(str(_wav_header(tmp_path / "f64.wav", 3, 64)))
    assert not playback.native(str(_wav_header(tmp_path / "adpcm.wav", 2, 4)))
    assert not playback.native(str(_aiff16(tmp_path / "a.aiff")))
    for name in ("x.mp3", "x.flac", "x.ogg", "x.opus"):
        (tmp_path / name).write_bytes(b"")
        assert playback.native(str(tmp_path / name))
    (tmp_path / "x.wma").write_bytes(b"")
    assert not playback.native(str(tmp_path / "x.wma"))


def test_m4a_with_apple_lossless_is_decoded(tmp_path):
    def m4a(codec):
        stsd = b"stsd" + codec
        moov = struct.pack(">I", 8 + len(stsd)) + b"moov" + stsd
        return struct.pack(">I", 16) + b"ftypM4A \x00\x00\x00\x00" + moov
    (tmp_path / "aac.m4a").write_bytes(m4a(b"mp4a"))
    (tmp_path / "alac.m4a").write_bytes(m4a(b"alac"))
    assert playback.native(str(tmp_path / "aac.m4a"))
    assert not playback.native(str(tmp_path / "alac.m4a"))


@needs_ffmpeg
def test_aiff_is_decoded_in_memory_and_nothing_is_written(tmp_path):
    src = _aiff16(tmp_path / "Song.aiff")
    before = sorted(os.listdir(tmp_path))
    wav = playback.decode(str(src))
    assert sorted(os.listdir(tmp_path)) == before
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert struct.unpack("<I", wav[4:8])[0] == len(wav) - 8
    i = wav.index(b"data")
    assert struct.unpack("<I", wav[i + 4:i + 8])[0] == len(wav) - i - 8
    assert len(wav) - i - 8 == 4410 * 2 * 3  # 24-bit stereo, every frame


def test_part_requests_for_seeking():
    data = bytes(range(100))
    r = playback.wav_response(data, None)
    assert r.status_code == 200 and r.body == data and r.headers["accept-ranges"] == "bytes"
    r = playback.wav_response(data, "bytes=10-19")
    assert r.status_code == 206 and r.body == data[10:20]
    assert r.headers["content-range"] == "bytes 10-19/100"
    assert playback.wav_response(data, "bytes=90-").body == data[90:]
    assert playback.wav_response(data, "bytes=-5").body == data[95:]
    assert playback.wav_response(data, "bytes=200-").status_code == 416


@needs_ffmpeg
def test_api_plays_aiff(tmp_path):
    from fastapi.testclient import TestClient
    from ablebackup.api.app import create_app
    c = TestClient(create_app(token="t", db_path=tmp_path / "c.db"))
    src = _aiff16(tmp_path / "Song.aiff")
    c.app.state.catalog.is_export = lambda p: p == str(src)
    r = c.get("/api/exports/audio", params={"path": str(src), "t": "t"})
    assert r.status_code == 200 and r.content[:4] == b"RIFF"
    assert r.headers["content-type"] == "audio/wav"
    r = c.get("/api/exports/audio", params={"path": str(src), "t": "t"}, headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and len(r.content) == 100
    # a file that can't be decoded at all, when asked to decode
    bad = tmp_path / "Broken.wav"
    bad.write_bytes(b"not audio at all")
    c.app.state.catalog.is_export = lambda p: p == str(bad)
    assert c.get("/api/exports/audio", params={"path": str(bad), "t": "t", "decode": 1}).status_code == 415
