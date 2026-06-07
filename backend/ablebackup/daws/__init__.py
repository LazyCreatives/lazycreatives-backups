"""Per-DAW adapters: each knows how to discover and parse one DAW's projects.

Everything else (resolver, backup engine, dedup pool, verify, catalog, locator)
operates on the neutral FileRef / ProjectScan models and is reused across DAWs.
"""
