import hashlib
from ablebackup.hashing import hash_file


def test_hash_matches_hashlib(tmp_path):
    f = tmp_path / "a.bin"
    data = b"hello world" * 1000
    f.write_bytes(data)
    expected = hashlib.sha256(data).hexdigest()
    assert hash_file(f) == expected


def test_identical_content_same_hash(tmp_path):
    (tmp_path / "a").write_bytes(b"same")
    (tmp_path / "b").write_bytes(b"same")
    assert hash_file(tmp_path / "a") == hash_file(tmp_path / "b")
