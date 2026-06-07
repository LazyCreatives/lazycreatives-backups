import os

# The test suite runs in "dev" mode: enable the demo license keys (they are
# fail-closed / disabled in shipped builds — see entitlement._dev_keys_enabled).
os.environ.setdefault("ABLEBACKUP_DEV", "1")
