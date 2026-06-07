"""Licensing entitlement — the single source of truth for Free vs Pro features.

The whole app reads features from here. License activation is stubbed with test
keys for now; the real path is Lemon Squeezy's /v1/licenses/activate (see
brand/business/paywall-eng-scope.md). Per the plan: one online check at
activation, then cache + run offline.
"""

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

# Placeholder license keys until Lemon Squeezy is wired. Replace activate_key()
# with a real LS /v1/licenses/activate call (cache the result locally after).
_TEST_KEYS = {
    "LC-PRO-DEMO-2026": "pro",
    "LC-STUDIO-DEMO-2026": "studio",
}


def features_for(tier: str) -> dict:
    return dict(FEATURES.get(tier, FEATURES["free"]))


def allows(tier: str, feature: str) -> bool:
    return bool(features_for(tier).get(feature, False))


def activate_key(key: str):
    """Return the tier a license key grants, or None if unrecognised.

    TODO(payments): replace with Lemon Squeezy License API activation.
    """
    return _TEST_KEYS.get((key or "").strip().upper())
