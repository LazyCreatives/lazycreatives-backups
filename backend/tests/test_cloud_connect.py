"""Unit tests for the one-click cloud connect (rclone OAuth) state machine.

`rclone` is stubbed via an injectable `popen`, so these run with no real binary,
network, or browser.
"""
import time

from ablebackup.service import CLOUD_PROVIDERS, CloudConnectSession, safe_remote_name


class _FakeStream:
    """A subprocess.stdout stand-in: iterable line-by-line and .read()-able."""

    def __init__(self, lines):
        self._lines = list(lines)

    def __iter__(self):
        return iter(self._lines)

    def read(self):
        return "".join(self._lines)


class _FakeProc:
    """Minimal stand-in for subprocess.Popen: emits `lines`, then exits with `code`."""

    def __init__(self, lines, code=0):
        self.stdout = _FakeStream(lines)
        self._code = code
        self._done = False

    def wait(self):
        self._done = True
        return self._code

    def poll(self):
        return self._code if self._done else None

    def terminate(self):
        self._done = True


# A realistic `rclone authorize` transcript: prints the loopback auth URL, then the
# OAuth token between its paste markers.
_AUTHORIZE_OK = [
    "2024/01/01 NOTICE: Config file written\n",
    "If your browser doesn't open automatically go to the following link: "
    "http://127.0.0.1:53682/auth?state=abc123 then complete the authorization\n",
    "Waiting for code...\n",
    "Got code\n",
    "Paste the following into your remote machine --->\n",
    '{"access_token":"ya29.tok","token_type":"Bearer","refresh_token":"1//r","expiry":"2026-01-01T00:00:00Z"}\n',
    "<---End paste\n",
]


def _await_terminal(sess, timeout=2.0):
    deadline = time.time() + timeout
    while sess.status == "pending" and time.time() < deadline:
        time.sleep(0.01)
    return sess.status


def test_safe_remote_name_sanitizes_and_dedupes():
    assert safe_remote_name("Google Drive!") == "GoogleDrive"
    assert safe_remote_name("") == "cloud"
    assert safe_remote_name("gdrive", ["gdrive"]) == "gdrive-2"
    assert safe_remote_name("gdrive", ["gdrive", "gdrive-2"]) == "gdrive-3"


def test_connect_captures_auth_url_and_connects():
    # popen is called twice (authorize, then config create); both succeed.
    sess = CloudConnectSession("drive", "gdrive", rclone="rclone",
                               popen=lambda *a, **k: _FakeProc(_AUTHORIZE_OK, code=0))
    sess.start()
    assert sess.wait_for_url(2) == "http://127.0.0.1:53682/auth?state=abc123"
    assert _await_terminal(sess) == "connected"
    assert sess.error is None


def test_providers_registered():
    assert {"drive", "dropbox", "onedrive"} <= set(CLOUD_PROVIDERS)


def test_connect_requests_drive_file_scope():
    sess = CloudConnectSession("drive", "gdrive", rclone="rclone")
    assert sess._rclone_params() == {"scope": "drive.file"}  # minimal, review-free scope
    assert sess._env()["RCLONE_DRIVE_SCOPE"] == "drive.file"  # applied to the OAuth consent


def test_dropbox_has_no_scope_param():
    sess = CloudConnectSession("dropbox", "dropbox", rclone="rclone")
    assert sess._rclone_params() == {}                     # dropbox takes no scope
    assert "RCLONE_DROPBOX_SCOPE" not in sess._env()


def test_connect_failure_surfaces_rclone_output():
    sess = CloudConnectSession("drive", "gdrive", rclone="rclone",
                               popen=lambda *a, **k: _FakeProc(["Failed: bad client id\n"], code=1))
    sess.start()
    sess.wait_for_url(2)
    assert _await_terminal(sess) == "failed"
    assert "bad client id" in (sess.error or "")


def test_connect_without_rclone_fails_fast():
    sess = CloudConnectSession("drive", "gdrive", rclone=None)
    sess.start()
    assert sess.status == "failed"
    assert sess.wait_for_url(0.5) is None
    assert "rclone" in (sess.error or "").lower()


def test_connect_unknown_provider_fails():
    sess = CloudConnectSession("nope", "x", rclone="rclone",
                               popen=lambda *a, **k: _FakeProc([], code=0))
    sess.start()
    assert sess.status == "failed"
