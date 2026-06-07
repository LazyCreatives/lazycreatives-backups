import hashlib
import shutil
from pathlib import Path

_CHUNK = 1024 * 1024


def hash_file(path: Path) -> str:
    """Return the SHA-256 hex digest of a file's contents."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()


def hash_copy(src, dst) -> str:
    """Copy src -> dst and return the SHA-256 of the bytes ACTUALLY written.

    One read pass (no double-I/O), and the digest reflects exactly what landed at
    dst — so the caller can confirm it matches the expected digest and never
    publish a mismatched (e.g. source-changed-mid-copy) file into the pool.
    """
    h = hashlib.sha256()
    with open(src, "rb") as fi, open(dst, "wb") as fo:
        while chunk := fi.read(_CHUNK):
            h.update(chunk)
            fo.write(chunk)
    shutil.copystat(src, dst)
    return h.hexdigest()
