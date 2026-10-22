"""Keeps a saved password (the NAS login) unreadable at rest.

On Windows it is locked with DPAPI, so only this Windows account can read it. On a
Mac and on Linux it is encrypted with AES-GCM under a random key kept in a file only
this user can read (``secret.key``, mode 0600, next to the catalog).

Never the macOS Keychain: the installers are unsigned, so every update looks like a
new app to macOS and each Keychain read pops a password prompt.

Stored as a self-describing string: ``dpapi:<b64>`` or ``aesgcm:<b64>``.
"""
import base64
import os
import secrets
import sys
from pathlib import Path

_WIN = sys.platform == "win32"
_KEY_FILE = "secret.key"

if _WIN:
    import ctypes
    from ctypes import wintypes

    class _BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def _dpapi(fn, data: bytes) -> bytes:
        buf = ctypes.create_string_buffer(data, len(data))
        din = _BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
        out = _BLOB()
        if not fn(ctypes.byref(din), None, None, None, None, 0, ctypes.byref(out)):
            raise OSError("DPAPI call failed")
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            ctypes.windll.kernel32.LocalFree(out.pbData)


def _key(key_dir: Path) -> bytes:
    path = Path(key_dir) / _KEY_FILE
    try:
        k = path.read_bytes()
        if len(k) == 32:
            return k
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    k = secrets.token_bytes(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(k)
    return k


def lock(text: str, key_dir: Path) -> str:
    data = text.encode("utf-8")
    if _WIN:
        return "dpapi:" + base64.b64encode(_dpapi(ctypes.windll.crypt32.CryptProtectData, data)).decode()
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    return "aesgcm:" + base64.b64encode(nonce + AESGCM(_key(key_dir)).encrypt(nonce, data, None)).decode()


def unlock(stored: str | None, key_dir: Path) -> str | None:
    """The saved text, or None if there is none or it can't be read any more (a
    different computer or account): the user then types the password again."""
    if not stored:
        return None
    try:
        kind, b64 = stored.split(":", 1)
        raw = base64.b64decode(b64)
        if kind == "dpapi" and _WIN:
            return _dpapi(ctypes.windll.crypt32.CryptUnprotectData, raw).decode("utf-8")
        if kind == "aesgcm":
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            return AESGCM(_key(key_dir)).decrypt(raw[:12], raw[12:], None).decode("utf-8")
    except Exception:
        return None
    return None
