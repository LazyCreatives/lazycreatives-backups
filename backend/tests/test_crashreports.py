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
