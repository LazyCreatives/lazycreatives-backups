import math
import struct
import wave

from ablebackup import waveform


def _write_wav(path, width, frames):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(width)
        w.setframerate(44100)
        w.writeframes(frames)


def test_wav_16bit_outline_follows_the_volume(tmp_path):
    # quiet first half, loud second half
    n = 44100
    samples = [int((0.1 if i < n // 2 else 0.9) * 32767 * math.sin(i / 10)) for i in range(n)]
    p = tmp_path / "song.wav"
    _write_wav(p, 2, struct.pack(f"<{n}h", *samples))
    out = waveform.peaks(str(p), bars=10)
    assert out is not None and len(out) == 10
    assert max(out) == 1.0
    assert max(out[:4]) < 0.2 and min(out[6:]) > 0.8


def test_wav_24bit_is_read(tmp_path):
    n = 4410
    frames = b"".join(int(0.5 * 8388607 * math.sin(i / 10)).to_bytes(3, "little", signed=True) for i in range(n))
    p = tmp_path / "song24.wav"
    _write_wav(p, 3, frames)
    out = waveform.peaks(str(p), bars=5)
    assert out is not None and all(v > 0.9 for v in out)


def test_other_formats_return_none(tmp_path):
    p = tmp_path / "song.mp3"
    p.write_bytes(b"ID3not really audio")
    assert waveform.peaks(str(p)) is None
    assert waveform.peaks(str(tmp_path / "missing.wav")) is None


def test_aiff_16bit_is_read(tmp_path):
    if waveform.aifc is None:
        return
    n = 4410
    p = tmp_path / "song.aif"
    with waveform.aifc.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(struct.pack(f">{n}h", *[int(0.5 * 32767 * math.sin(i / 10)) for i in range(n)]))
    out = waveform.peaks(str(p), bars=5)
    assert out is not None and all(v > 0.9 for v in out)
