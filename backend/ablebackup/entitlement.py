"""Licensing entitlement — the single source of truth for Free vs Pro features.

The whole app reads features from here. License activation uses Lemon Squeezy's
License API when configured (env: LS_PRO_VARIANT / LS_STUDIO_VARIANT, the variant
ids of your Pro/Studio products). Per the plan: one online check at activation,
then cache locally and run offline.

Security (fixes audit findings):
- Built-in demo keys ONLY work when ABLEBACKUP_DEV is set (dev/CI). A packaged
  build sets neither LS_* nor ABLEBACKUP_DEV, so activation *fails closed* (stays
  Free) — no free-Pro backdoor ships.
- The stored tier is HMAC-signed (sign_tier) and verified on read (verify_stored)
  so hand-editing the local SQLite to grant a paid tier is rejected.
"""
import hmac
import json as _json
import os
import urllib.parse
import urllib.request

# Feature gate map (brand/business/paywall-eng-scope.md §1).
FEATURES = {
    "free": {
        "scheduled": False,       # automatic/scheduled backups
        "restore": False,         # restore a backup to a chosen folder
        "multi_daw": False,       # FL / Reaper / DAWproject (Free = Ableton only)
        "auto_relink": False,     # auto-find missing samples in the library
        "deep_verify": False,     # full deep re-hash verify (Free = on-demand, basic)
        "cloud_backup": False,    # offsite/cloud mirror destinations (top tier)
        "max_destinations": 1,
    },
    "pro": {
        "scheduled": True, "restore": True, "multi_daw": True,
        "auto_relink": True, "deep_verify": True, "cloud_backup": False,
        "max_destinations": 99,   # unlimited LOCAL destinations
    },
    "studio": {
        "scheduled": True, "restore": True, "multi_daw": True,
        "auto_relink": True, "deep_verify": True, "cloud_backup": True,  # offsite/cloud
        "max_destinations": 99,
    },
}

VALID_TIERS = tuple(FEATURES)

# Demo keys for development/CI only — honoured ONLY when ABLEBACKUP_DEV is set, so
# they cannot unlock a paid tier in a shipped build.
_TEST_KEYS = {
    "LC-PRO-DEMO-2026": "pro",
    "LC-STUDIO-DEMO-2026": "studio",
}

_LS_BASE = "https://api.lemonsqueezy.com/v1/licenses"

# Build-embedded secret for signing the locally-cached entitlement. Not a true
# server secret (it ships in the binary), but it raises tampering well past a
# trivial `sqlite3 UPDATE` — consistent with the plan's "friction-light, not Fort
# Knox" stance. Override per build with ABLEBACKUP_ENT_SECRET if desired.
_ENT_SECRET = os.environ.get("ABLEBACKUP_ENT_SECRET", "ROTATED-SECRET-REDACTED").encode()


def _dev_keys_enabled() -> bool:
    return bool(os.environ.get("ABLEBACKUP_DEV"))


def sign_tier(tier: str, key, instance_id) -> str:
    """HMAC over the entitlement so a hand-edited DB row is rejected on read."""
    msg = f"{tier}|{key or ''}|{instance_id or ''}".encode()
    return hmac.new(_ENT_SECRET, msg, "sha256").hexdigest()


def verify_stored(stored: dict) -> str:
    """The verified tier from a stored entitlement, or 'free' if missing/forged."""
    tier = (stored or {}).get("tier", "free")
    if tier == "free" or tier not in VALID_TIERS:
        return "free"
    expected = sign_tier(tier, stored.get("key"), stored.get("instance_id"))
    sig = stored.get("sig") or ""
    return tier if hmac.compare_digest(sig, expected) else "free"


def features_for(tier: str) -> dict:
    return dict(FEATURES.get(tier, FEATURES["free"]))


def allows(tier: str, feature: str) -> bool:
    return bool(features_for(tier).get(feature, False))


def _variant_to_tier(variant_id) -> str | None:
    vid = str(variant_id or "")
    if vid and vid == os.environ.get("LS_STUDIO_VARIANT", ""):
        return "studio"
    if vid and vid == os.environ.get("LS_PRO_VARIANT", ""):
        return "pro"
    return None


def _ls_enabled() -> bool:
    return bool(os.environ.get("LS_PRO_VARIANT") or os.environ.get("LS_STUDIO_VARIANT"))


def _ls_request(path: str, payload: dict) -> dict | None:
    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(
        _LS_BASE + path, data=data, method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            return _json.load(r)
    except Exception:
        return None  # network/HTTP error — treat as activation failure


def activate(key: str) -> dict | None:
    """Validate + activate a license key. Returns {"tier", "instance_id"} or None.

    Lemon Squeezy when configured; otherwise the demo keys but ONLY in dev. A
    shipped build with neither configured fails closed (returns None -> Free).
    """
    key = (key or "").strip()
    if not key:
        return None
    if _ls_enabled():
        body = _ls_request("/activate", {"license_key": key, "instance_name": "LazyCreatives Backups"})
        if not body or not body.get("activated"):
            return None
        tier = _variant_to_tier((body.get("meta") or {}).get("variant_id"))
        if tier is None:
            return None  # a valid key, but for a product we don't map to a tier
        return {"tier": tier, "instance_id": (body.get("instance") or {}).get("id")}
    if _dev_keys_enabled():
        tier = _TEST_KEYS.get(key.upper())
        return {"tier": tier, "instance_id": None} if tier else None
    return None  # fail closed: not configured + not dev -> no activation


def deactivate(key: str, instance_id) -> None:
    """Release a seat on Lemon Squeezy (best-effort). No-op for test keys."""
    if _ls_enabled() and key and instance_id:
        _ls_request("/deactivate", {"license_key": key, "instance_id": instance_id})
