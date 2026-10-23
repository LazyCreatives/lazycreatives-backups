"""A network folder that won't let us in counts as not there.

On Windows, asking whether \\\\NAS\\Backups exists while the saved NAS login is wrong
(or the NAS dropped off) raises "the user name or password is incorrect" instead
of answering no, so every screen that looked at the backup place failed outright.
pathlib already answers no for a few Windows errors; these network ones join them,
so the app sees a missing backup place and says so in plain words (and the NAS
login is tried again), the same as for an unplugged drive.
"""
import pathlib

NETWORK_WINERRORS = (
    53,    # the network path was not found
    59,    # an unexpected network error occurred
    64,    # the network name is no longer available
    67,    # the network name cannot be found
    86,    # the network password is not correct
    121,   # the semaphore timeout period has expired (a NAS that stopped answering)
    1219,  # multiple connections with different logins
    1222,  # the network is not present
    1311,  # no logon servers available
    1326,  # the user name or password is incorrect
    1331,  # account disabled
    1909,  # account locked out
)


def install() -> None:
    for name in ("pathlib", "pathlib._abc", "pathlib._local"):
        try:
            mod = __import__(name, fromlist=["_"])
        except ImportError:
            continue
        old = getattr(mod, "_IGNORED_WINERRORS", None)
        if isinstance(old, tuple):
            mod._IGNORED_WINERRORS = tuple(dict.fromkeys(old + NETWORK_WINERRORS))
    assert pathlib  # imported for its side table above


install()
