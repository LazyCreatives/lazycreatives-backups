import json

from ablebackup import crashreports


def test_reports_on_by_default(tmp_path):
    assert crashreports.reports_on(None)
    assert crashreports.reports_on(str(tmp_path / "missing.json"))


def test_reports_follow_the_switch(tmp_path):
    pref = tmp_path / "crash-reports.json"
    pref.write_text(json.dumps({"on": False}))
    assert not crashreports.reports_on(str(pref))
    pref.write_text(json.dumps({"on": True}))
    assert crashreports.reports_on(str(pref))


def test_broken_file_counts_as_on(tmp_path):
    pref = tmp_path / "crash-reports.json"
    pref.write_text("not json")
    assert crashreports.reports_on(str(pref))


def test_start_does_nothing_without_a_dsn(monkeypatch):
    monkeypatch.delenv("LC_SENTRY_DSN", raising=False)
    assert crashreports.start() is False


def test_a_dropped_connection_is_not_reported():
    err = ConnectionResetError(10054, "An existing connection was forcibly closed")
    event = {"logger": "asyncio", "exception": {"values": [{"type": "ConnectionResetError"}]}}
    assert crashreports.harmless(event, {"exc_info": (type(err), err, None)})
    assert crashreports.harmless(event, {})


def test_real_errors_are_still_reported():
    err = OSError(22, "Invalid argument")
    assert not crashreports.harmless({"logger": None}, {"exc_info": (type(err), err, None)})
    reset = ConnectionResetError(10054, "closed")
    assert not crashreports.harmless({"logger": "ablebackup"}, {"exc_info": (type(reset), reset, None)})
