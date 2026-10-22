"""Keeps the computer awake while a backup runs.

A Mac (or PC) that goes to sleep part way through a long backup stops it, and a NAS
connection usually drops while it sleeps. While a backup runs, Backups asks the
computer not to go to sleep by itself: the screen can still turn off, and closing a
laptop's lid or choosing Sleep still works.

- Mac: the built-in "caffeinate -i" for as long as the backup runs.
- Windows: SetThreadExecutionState(ES_SYSTEM_REQUIRED) on this thread.
- Linux: "systemd-inhibit" when it's there.
"""
import contextlib
import os
import subprocess
import sys

_ES_CONTINUOUS = 0x80000000
_ES_SYSTEM_REQUIRED = 0x00000001


@contextlib.contextmanager
def keep_awake():
    proc = None
    win = False
    try:
        if sys.platform == "darwin":
            proc = subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif sys.platform == "win32":
            import ctypes
            win = bool(ctypes.windll.kernel32.SetThreadExecutionState(_ES_CONTINUOUS | _ES_SYSTEM_REQUIRED))
        else:
            proc = subprocess.Popen(["systemd-inhibit", "--what=idle:sleep", "--who=LazyCreatives Backups",
                                     "--why=Backing up your projects", "--mode=block", "sleep", "infinity"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:  # no way to ask on this computer: back up anyway
        proc = None
    try:
        yield
    finally:
        if proc is not None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                pass
        if win:
            try:
                import ctypes
                ctypes.windll.kernel32.SetThreadExecutionState(_ES_CONTINUOUS)
            except Exception:
                pass
