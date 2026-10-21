"""Crash reports from the engine to Sentry (Settings > Privacy > Send crash reports).

The app's main process turns this on by passing LC_SENTRY_DSN (only in the installed
app, never in development or tests) and LC_CRASH_PREF, the file that holds the
person's on/off choice. The choice is read again for every report, so switching it
off in Settings stops reports straight away without restarting the engine.
Local variables are never sent, so logins and tokens in memory stay on the computer.
"""
from __future__ import annotations

import json
import os


def reports_on(pref_path: str | None) -> bool:
    """On unless the person switched it off. A missing or unreadable file means on."""
    if not pref_path:
        return True
    try:
        with open(pref_path, encoding="utf-8") as f:
            return json.load(f).get("on", True) is not False
    except (OSError, ValueError, AttributeError):
        return True


def start() -> bool:
    """Start Sentry when the app asked for it. Returns True when reports are set up."""
    dsn = os.environ.get("LC_SENTRY_DSN", "")
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        return False
    pref = os.environ.get("LC_CRASH_PREF")

    def before_send(event, _hint):
        return event if reports_on(pref) else None

    sentry_sdk.init(
        dsn=dsn,
        release=os.environ.get("LC_SENTRY_RELEASE") or None,
        environment=os.environ.get("LC_SENTRY_ENV", "production"),
        send_default_pii=False,
        include_local_variables=False,
        server_name="",
        traces_sample_rate=0,
        auto_session_tracking=False,  # no usage pings, so "off" means nothing is sent
        before_send=before_send,
    )
    return True
