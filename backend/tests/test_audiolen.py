import struct
import wave

from ablebackup import audiolen


def _wav(path, secs, rate=44100):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"\0\0\0\0" * int(secs * rate))


def _ext80(rate):
    import math
    m, e = math.frexp(rate)
    return struct.pack(">HQ", 16383 + e - 1, int(m * 2 ** 64))


def test_wav_length(tmp_path):
    p = tmp_path / "a.wav"
    _wav(p, 2.5)
    assert abs(audiolen.seconds(str(p)) - 2.5) < 0.01


def test_aiff_length(tmp_path):
    p = tmp_path / "a.aiff"
    comm = struct.pack(">hIh", 2, 48000 * 40, 16) + _ext80(48000)
    p.write_bytes(b"FORM" + struct.pack(">I", 4 + 8 + len(comm)) + b"AIFF" + b"COMM" + struct.pack(">I", len(comm)) + comm)
    assert abs(audiolen.seconds(str(p)) - 40) < 0.01


def test_flac_length(tmp_path):
    p = tmp_path / "a.flac"
    rate, total = 44100, 44100 * 95
    bits = (rate << 44) | (1 << 41) | (15 << 36) | total   # stereo, 16-bit
    info = b"\0" * 10 + bits.to_bytes(8, "big") + b"\0" * 16
    p.write_bytes(b"fLaC" + bytes([0x80, 0, 0, 34]) + info)
    assert abs(audiolen.seconds(str(p)) - 95) < 0.01


def test_mp3_length_from_bitrate(tmp_path):
    p = tmp_path / "a.mp3"
    frame = bytes([0xFF, 0xFB, 0x90, 0x00])   # MPEG-1 Layer III, 128 kbps, 44.1 kHz
    p.write_bytes(frame + b"\0" * (16000 * 20 - 4))   # 20 s at 16000 bytes a second
    assert abs(audiolen.seconds(str(p)) - 20) < 0.1


def test_unknown_and_broken(tmp_path):
    m = tmp_path / "a.m4a"; m.write_bytes(b"\0" * 100)
    b = tmp_path / "b.wav"; b.write_bytes(b"not a wav")
    assert audiolen.seconds(str(m)) is None
    assert audiolen.seconds(str(b)) is None
    assert audiolen.seconds(str(tmp_path / "gone.wav")) is None
