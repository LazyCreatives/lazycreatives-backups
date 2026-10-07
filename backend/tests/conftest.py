import os

# Tests exercise the real free/Pro/Studio locks, not the free-beta unlock.
os.environ.setdefault("ABLEBACKUP_FREE_BETA", "0")

import os

# The test suite runs in "dev" mode: enable the demo license keys (they are
# fail-closed / disabled in shipped builds — see entitlement._dev_keys_enabled).
os.environ.setdefault("ABLEBACKUP_DEV", "1")
# Never read a real Uploader install on the machine running the tests; tests that
# need one point this at a fixture catalog.
os.environ.setdefault("ABLEBACKUP_UPLOADER_DB", os.path.join(os.sep, "nonexistent", "uploader.db"))
# Don't go looking for exports folders around the shared temp directory (other tests'
# folders live there); the tests for that turn it back on.
os.environ.setdefault("ABLEBACKUP_FIND_EXPORT_FOLDERS", "0")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _own_albums_list(tmp_path, monkeypatch):
    """Albums are shared with Uploader in a file outside the app; tests get their own."""
    monkeypatch.setenv("LC_ALBUMS_DB", str(tmp_path / "shared-albums.db"))
