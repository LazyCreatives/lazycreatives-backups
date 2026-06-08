"""Orchestration layer: reusable scan/backup over the engine, with progress events."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from ablebackup.backup_engine import backup_project
from ablebackup.catalog import Catalog
from ablebackup.daws.registry import DAW_REGISTRY, adapter_for_id
from ablebackup.hashing import hash_file
from ablebackup.locator import default_libraries, make_locator
from ablebackup.models import ProjectScan
from ablebackup.scanner import scan_one, scan_projects
from ablebackup.verifier import verify_snapshot

ProgressCb = Optional[Callable[[dict], None]]


def _build_locator(sources, libraries):
    """A name->path locator over the user's libraries (default: Splice) + sources."""
    roots = [Path(lib) for lib in (libraries or [])] or default_libraries()
    roots += [Path(s) for s in sources]
    return make_locator(roots)


def default_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H%M")


def project_signature(scan: ProjectScan, portable: bool = False, layout: str = "project_date") -> str:
    """A content fingerprint of a project. Ableton rewrites the .als on every save,
    so we hash its actual content (robust to a same-size/same-second edit) plus each
    present sample's size + mtime. The run's portable/layout choice is folded in so
    that asking for a portable backup of an otherwise-unchanged project is NOT
    skipped (it would leave the user without the portable snapshot they asked for).
    Unchanged content + same options => same signature => no new snapshot."""
    h = hashlib.sha1()
    h.update(f"opts:{int(portable)}:{layout}|".encode())
    try:
        h.update(hash_file(scan.als_path).encode())
    except OSError:
        h.update(f"{scan.size}:{int(scan.mtime)}".encode())  # fall back if unreadable
    for path, size, mtime in sorted(
        (str(r.resolved_path), r.size, int(r.mtime)) for r in scan.refs if r.exists
    ):
        h.update(f"|{path}:{size}:{mtime}".encode())
    return h.hexdigest()


def _is_rclone_remote(dest: str) -> bool:
    """An offsite target is an rclone remote (e.g. s3:bucket/path, gdrive:Backups)
    rather than a local folder. Local POSIX paths start with '/'."""
    if dest.startswith("rclone:"):
        return True
    return not os.path.isabs(dest) and bool(re.match(r"^[\w-]+:", dest))


def rclone_path() -> str | None:
    """Path to the rclone binary: an explicit override (a packaged build points
    ABLEBACKUP_RCLONE at the bundled binary) else whatever is on PATH."""
    return os.environ.get("ABLEBACKUP_RCLONE") or shutil.which("rclone")


def rclone_available() -> bool:
    return rclone_path() is not None


def rclone_remotes() -> list[str]:
    """Configured rclone remote names (without the trailing ':'), or [] if none."""
    rc = rclone_path()
    if not rc:
        return []
    try:
        out = subprocess.run([rc, "listremotes"], capture_output=True, text=True, timeout=10)
        return [r.rstrip(":") for r in out.stdout.split() if r.strip()]
    except (OSError, subprocess.SubprocessError):
        return []


def _rclone_copy(src: Path, remote_dest: str) -> bool:
    rc = rclone_path()
    if not rc:
        return False
    try:
        r = subprocess.run([rc, "copy", str(src), remote_dest, "--quiet"],
                           capture_output=True, text=True, timeout=3600)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


# --- one-click cloud connect: drive rclone's built-in OAuth for the user ---------

# Providers exposed as a one-click "Connect" button. The value is the rclone backend
# type plus the env vars that (optionally) override the OAuth client + scope for a
# branded production build. Add a line here to support Dropbox / OneDrive / etc.
CLOUD_PROVIDERS: dict[str, dict] = {
    "drive": {
        "type": "drive",
        "label": "Google Drive",
        # app-created files only — sufficient for a backup tool and avoids Google's
        # costly restricted-scope security assessment that full "drive" triggers.
        "default_scope": "drive.file",
        "scope_env": "ABLEBACKUP_GDRIVE_SCOPE",
        "client_id_env": "ABLEBACKUP_GDRIVE_CLIENT_ID",
        "client_secret_env": "ABLEBACKUP_GDRIVE_CLIENT_SECRET",
    },
    "dropbox": {
        "type": "dropbox",
        "label": "Dropbox",
        "client_id_env": "ABLEBACKUP_DROPBOX_CLIENT_ID",
        "client_secret_env": "ABLEBACKUP_DROPBOX_CLIENT_SECRET",
    },
    "onedrive": {
        "type": "onedrive",
        "label": "OneDrive",
        "client_id_env": "ABLEBACKUP_ONEDRIVE_CLIENT_ID",
        "client_secret_env": "ABLEBACKUP_ONEDRIVE_CLIENT_SECRET",
    },
}

# rclone's loopback OAuth helper prints a URL like
# "http://127.0.0.1:53682/auth?state=..." for the user to open; we relay it to their
# browser and rclone captures the token when Google redirects back to that port.
_RCLONE_AUTH_URL_RE = re.compile(r"https?://127\.0\.0\.1:\d+/auth\?\S+")
_REMOTE_NAME_RE = re.compile(r"[^A-Za-z0-9_-]+")


def safe_remote_name(raw: str, taken: list[str] | None = None) -> str:
    """An rclone-legal remote name (alnum / _ / -), made unique against `taken` so a
    second Google account doesn't silently overwrite the first remote's tokens."""
    name = _REMOTE_NAME_RE.sub("", (raw or "").strip()) or "cloud"
    existing = set(taken or [])
    if name not in existing:
        return name
    i = 2
    while f"{name}-{i}" in existing:
        i += 1
    return f"{name}-{i}"


class CloudConnectSession:
    """Drives one rclone OAuth 'Connect' flow on the user's behalf, in two phases:

    1. `rclone authorize <type> --auth-no-open-browser` runs rclone's loopback OAuth:
       it prints a 127.0.0.1 auth URL (we relay it to the user's browser), waits for
       them to approve in their Google/etc. account, then prints an OAuth token.
    2. `rclone config create <name> <type> token=<json> …` persists that token as a
       reusable remote in rclone.conf, which backups then copy to.

    The provider's scope / OAuth client are passed as rclone backend env options
    (RCLONE_<TYPE>_SCOPE etc.) so the consent screen requests the right (minimal)
    scope. `popen` is injectable so the state machine is unit-testable without rclone.
    """

    _TOKEN_RE = re.compile(r'\{.*"access_token".*\}')

    def __init__(self, provider_key: str, name: str, *, rclone: str | None = None,
                 popen=subprocess.Popen):
        self.provider_key = provider_key
        self.name = name
        self.status = "pending"           # pending | connected | failed
        self.auth_url: str | None = None
        self.error: str | None = None
        self._rclone = rclone or rclone_path()
        self._popen = popen
        self._proc = None
        self._token: str | None = None
        self._url_ready = threading.Event()

    def _provider(self) -> dict:
        return CLOUD_PROVIDERS[self.provider_key]

    def _rclone_params(self) -> dict[str, str]:
        """Backend config (scope / OAuth client) to apply during auth and persist on
        the remote. Only what's set — defaults to the provider's minimal scope."""
        prov = self._provider()
        params: dict[str, str] = {}
        scope = os.environ.get(prov.get("scope_env", "")) or prov.get("default_scope")
        if scope:  # only providers that declare a scope (e.g. Drive) get one
            params["scope"] = scope
        cid = os.environ.get(prov.get("client_id_env", ""))
        secret = os.environ.get(prov.get("client_secret_env", ""))
        if cid and secret:  # branded build: our own OAuth client, not rclone's shared one
            params["client_id"], params["client_secret"] = cid, secret
        return params

    def _env(self) -> dict:
        """rclone reads RCLONE_<BACKEND>_<OPTION> env vars, so set our scope/client
        there — that way the OAuth consent (authorize) requests the right scope."""
        env = dict(os.environ)
        backend = self._provider()["type"].upper()
        for key, val in self._rclone_params().items():
            env[f"RCLONE_{backend}_{key.upper()}"] = val
        return env

    def start(self) -> None:
        if not self._rclone:
            self._fail("The cloud engine (rclone) isn't available.")
            return
        if self.provider_key not in CLOUD_PROVIDERS:
            self._fail("Unknown cloud provider.")
            return
        threading.Thread(target=self._run, name=f"cloud-connect-{self.name}",
                         daemon=True).start()

    def _fail(self, msg: str) -> None:
        self.status = "failed"
        self.error = msg
        self._url_ready.set()

    def _spawn(self, args: list[str]):
        return self._popen(
            args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,  # any unexpected prompt hits EOF and fails fast (no hang)
            text=True, bufsize=1, env=self._env(),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),  # no console flash on Windows
        )

    def _run(self) -> None:
        try:
            token = self._authorize()
        except OSError as e:
            self._fail(str(e))
            return
        if token is None:
            if self.status != "failed":
                self._fail(self.error or "Sign-in didn't complete.")
            self._url_ready.set()
            return
        if self._create_remote(token):
            self.status = "connected"
        elif self.status != "failed":
            self._fail(self.error or "Couldn't save the cloud connection.")
        self._url_ready.set()

    def _authorize(self) -> str | None:
        """Phase 1: run `rclone authorize`, capturing the browser auth URL then the
        resulting OAuth token. Returns the token JSON, or None on failure."""
        self._proc = self._spawn([self._rclone, "authorize", self._provider()["type"],
                                  "--auth-no-open-browser"])
        tail: list[str] = []
        for line in self._proc.stdout:
            tail.append(line)
            del tail[:-60]
            if self.auth_url is None:
                m = _RCLONE_AUTH_URL_RE.search(line)
                if m:
                    self.auth_url = m.group(0)
                    self._url_ready.set()
            if self._token is None:
                m = self._TOKEN_RE.search(line)
                if m:
                    self._token = m.group(0)
        code = self._proc.wait()
        self._url_ready.set()
        if self._token is None:
            self.error = ("".join(tail).strip()[-400:]
                          or f"rclone authorize exited with code {code}")
            return None
        return self._token

    def _create_remote(self, token: str) -> bool:
        """Phase 2: persist the authorized token as a named rclone remote."""
        args = [self._rclone, "config", "create", self.name, self._provider()["type"],
                f"token={token}"]
        for key, val in self._rclone_params().items():
            args.append(f"{key}={val}")
        proc = self._spawn(args)
        out = proc.stdout.read() if proc.stdout else ""
        if proc.wait() != 0:
            self.error = (out or "").strip()[-400:] or "rclone config create failed"
            return False
        return True

    def wait_for_url(self, timeout: float = 15.0) -> str | None:
        self._url_ready.wait(timeout)
        return self.auth_url

    def cancel(self) -> None:
        p = self._proc
        if p is not None and p.poll() is None:
            try:
                p.terminate()
            except OSError:
                pass


def cloud_disconnect(name: str) -> bool:
    """Forget a configured rclone remote (drops the local token/config). Returns
    whether rclone reported success."""
    rc = rclone_path()
    if not rc or not name:
        return False
    try:
        r = subprocess.run([rc, "config", "delete", name],
                           capture_output=True, text=True, timeout=15)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def mirror_snapshot(snapshot_dir: Path, base: Path, mirrors: list) -> tuple[int, int]:
    """Copy a freshly-written snapshot to each offsite/cloud destination as a
    standalone copy. A mirror may be a local/sync folder OR an rclone remote
    (s3:, b2:, gdrive:, …). A mirror failure never fails the primary backup, but it
    is COUNTED and reported (not silently swallowed) so the UI can warn the user
    their offsite copy didn't land. Returns (ok, failed)."""
    ok = failed = 0
    try:
        rel = Path(snapshot_dir).resolve().relative_to(Path(base).resolve())
    except ValueError:
        return 0, len(mirrors)
    for m in mirrors:
        try:
            if _is_rclone_remote(m):
                remote = m[len("rclone:"):] if m.startswith("rclone:") else m
                if _rclone_copy(snapshot_dir, f"{remote.rstrip('/')}/{rel.as_posix()}"):
                    ok += 1
                else:
                    failed += 1
            else:
                target = Path(m) / rel
                if not target.exists():
                    shutil.copytree(snapshot_dir, target)
                ok += 1
        except OSError:
            failed += 1  # drive unplugged, cloud folder busy, permission, …
    return ok, failed


def _genre_for_snapshot(snapshot_dir, project_name: str) -> dict:
    """Guess a snapshot's genre from its .als tempo + gathered sample names + name."""
    from ablebackup.als_parser import read_tempo
    from ablebackup.genre import guess_genre

    d = Path(snapshot_dir) if snapshot_dir else None
    bpm = None
    names: list[str] = []
    if d and d.is_dir():
        als = next(iter(d.glob("*.als")), None)  # tempo is Ableton-only
        if als:
            bpm = read_tempo(als)
        mf = d / "manifest.json"
        if mf.is_file():
            try:
                names = [Path(f["logical_path"]).name
                         for f in json.loads(mf.read_text()).get("files", [])]
            except (OSError, ValueError):
                pass
    return guess_genre(project_name, bpm, names)


def project_genres(catalog) -> dict:
    """project_name -> {genre, emoji, bpm, confidence, pending}. Reads ONLY cached
    genres (fast, no file I/O), so it never blocks a page load; uncached projects
    come back pending=True and are filled by backfill_genres() in the background."""
    from ablebackup.genre import emoji_for

    out: dict = {}
    for row in catalog.latest_per_project():
        name = row["project_name"]
        if row.get("genre_done"):
            out[name] = {"genre": row.get("genre"), "emoji": emoji_for(row.get("genre")),
                         "bpm": row.get("bpm"), "confidence": row.get("genre_conf") or 0.0,
                         "pending": False}
        else:
            out[name] = {"genre": None, "emoji": "🎵", "bpm": None,
                         "confidence": 0.0, "pending": True}
    return out


def backfill_genres(catalog) -> int:
    """Compute + cache genres for any project not yet done. Slow (reads each .als
    tempo), so call it OFF the request path. Returns how many it filled."""
    n = 0
    for row in catalog.latest_per_project():
        if row.get("genre_done"):
            continue
        g = _genre_for_snapshot(row.get("dir"), row["project_name"])
        try:
            catalog.set_genre(row["id"], g["genre"], g["bpm"], g["confidence"])
            n += 1
        except Exception:
            pass
    return n


def _manifest_files(snapshot_dir) -> dict | None:
    """logical_path -> file entry for a snapshot's manifest, or None if unreadable."""
    if not snapshot_dir:
        return None
    mf = Path(snapshot_dir) / "manifest.json"
    if not mf.is_file():
        return None
    try:
        return {f["logical_path"]: f for f in json.loads(mf.read_text()).get("files", [])}
    except (OSError, ValueError, KeyError):
        return None


def snapshot_diff(new_dir, old_dir) -> dict:
    """What changed between two snapshots, by comparing per-file content digests."""
    new = _manifest_files(new_dir)
    if new is None:
        return {"available": False, "added": [], "removed": [], "changed": [], "unchanged": 0}
    old = _manifest_files(old_dir) or {}
    added = sorted(p for p in new if p not in old)
    removed = sorted(p for p in old if p not in new)
    changed = sorted(p for p in new if p in old and new[p].get("digest") != old[p].get("digest"))
    unchanged = sum(1 for p in new if p in old and new[p].get("digest") == old[p].get("digest"))
    return {"available": True, "added": added, "removed": removed, "changed": changed, "unchanged": unchanged}


def restore_snapshot(snapshot_dir, target_dir) -> str:
    """Copy a snapshot back out to target_dir as a standalone, openable project.

    Hardlinks into the pool become real byte copies, and our internal files
    (manifest.json, .abid) are left out, so the restored folder is a clean project.
    """
    import json

    src = Path(snapshot_dir)
    if not src.is_dir():
        raise FileNotFoundError(f"snapshot folder not found: {src}")
    manifest = {}
    mf = src / "manifest.json"
    if mf.is_file():
        try:
            manifest = json.loads(mf.read_text())
        except (OSError, ValueError):
            pass
    name = manifest.get("project_name") or src.name
    ts = manifest.get("timestamp") or ""
    folder_name = f"{name} ({ts})" if ts else name
    dst = Path(target_dir) / folder_name
    n = 1
    while dst.exists():
        dst = Path(target_dir) / f"{folder_name} ({n})"
        n += 1
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("manifest.json", ".abid"))
    return str(dst)


def share_snapshot(snapshot_dir, target_dir) -> str:
    """Zip a snapshot into a single sendable file. A portable snapshot zips into a
    complete, self-contained project a collaborator can open straight away."""
    import zipfile

    src = Path(snapshot_dir)
    if not src.is_dir():
        raise FileNotFoundError(f"snapshot folder not found: {src}")
    manifest = _manifest_meta(src)
    name = manifest.get("project_name") or src.name
    ts = manifest.get("timestamp") or ""
    base = f"{name} ({ts})" if ts else name
    zip_path = Path(target_dir) / f"{base}.zip"
    n = 1
    while zip_path.exists():
        zip_path = Path(target_dir) / f"{base} ({n}).zip"
        n += 1
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in src.rglob("*"):
            if f.is_file() and f.name not in ("manifest.json", ".abid"):
                z.write(f, str(Path(base) / f.relative_to(src)))
    return str(zip_path)


def _manifest_meta(src: Path) -> dict:
    mf = src / "manifest.json"
    if mf.is_file():
        try:
            return json.loads(mf.read_text())
        except (OSError, ValueError):
            pass
    return {}


def _pool_size(dest_root: Path) -> int:
    """Actual bytes on disk in the dedup pool (the unique-file set)."""
    pool = dest_root / "_pool"
    total = 0
    if pool.exists():
        for dirpath, _dirs, files in os.walk(pool):
            for fn in files:
                try:
                    total += (Path(dirpath) / fn).stat().st_size
                except OSError:
                    pass
    return total


def refresh_pool_cache(catalog: Catalog, dest: str) -> int:
    """Walk the dedup pool (slow over a NAS) and cache the total, so the dashboard
    can read it instantly. Called in the background after backups and when stale."""
    if not dest or not Path(dest).is_dir():
        return 0
    total = sum(_pool_size(Path(dest) / a.backup_root) for a in DAW_REGISTRY)
    catalog.set_setting("pool_cache", {"actual_size": total, "at": time.time()})
    return total


def pool_cache_age(catalog: Catalog) -> Optional[float]:
    """Seconds since the pool size was last computed, or None if never."""
    cache = catalog.get_setting("pool_cache") or {}
    return time.time() - cache["at"] if "at" in cache else None


def build_overview(catalog: Catalog, dest: str) -> dict:
    """A health snapshot for the dashboard: totals, dedup savings, NAS status, attention.

    The pool size is read from cache (refresh_pool_cache populates it in the
    background) — walking the pool on every load made the NAS dashboard take ~15s.
    """
    totals = catalog.snapshot_totals()
    latest = catalog.latest_per_project()

    attention = [
        {
            "project_name": s["project_name"],
            "kind": "error" if s["status"] == "error" else "missing",
            "reason": (s["error"] or "last backup errored") if s["status"] == "error"
            else f"{s['missing_count']} sample(s) missing",
        }
        for s in latest
        if s["status"] == "error" or s["missing_count"] > 0
    ]

    last = latest[0] if latest else None

    nas = {"reachable": False, "path": "", "free_bytes": 0, "total_bytes": 0}
    if dest:
        nas["path"] = str(dest)
        if Path(dest).is_dir():
            nas["reachable"] = True
            try:
                usage = shutil.disk_usage(dest)  # one statvfs — fast
                nas["free_bytes"] = usage.free
                nas["total_bytes"] = usage.total
            except OSError:
                pass

    cache = catalog.get_setting("pool_cache") or {}
    pool_known = "actual_size" in cache
    actual_size = int(cache.get("actual_size", 0))

    logical_size = totals["logical_size"]
    return {
        "projects_protected": totals["projects_protected"],
        "snapshot_count": totals["snapshot_count"],
        "logical_size": logical_size,
        "actual_size": actual_size,
        "saved_bytes": max(0, logical_size - actual_size) if pool_known else 0,
        "pool_known": pool_known,  # false until the first background walk finishes
        "last_run": last["timestamp"] if last else None,
        "last_run_ok": bool(last) and last["status"] == "ok",
        "attention": attention,
        "nas": nas,
    }


def scan_summary(sources: list[Path], progress: ProgressCb = None,
                 find_missing: bool = False, libraries=None) -> list[dict]:
    """Scan sources and return JSON-serializable project summaries.

    When progress is given, emits scan_start/scan_progress/scan_done events so the
    UI can show live scan progress instead of an indefinite spinner. When
    find_missing is set, samples missing from their referenced path are searched
    for (by filename) in the user's libraries + sources and relinked when found.
    """
    locate = _build_locator(sources, libraries) if find_missing else None
    out = []
    for p in scan_projects([Path(s) for s in sources], progress=progress, locate=locate):
        out.append({
            "name": p.name,
            "daw": p.daw_id,
            "project_dir": str(p.project_dir),
            "als_path": str(p.project_path),
            "present_count": sum(1 for r in p.refs if r.exists),
            "relinked_count": sum(1 for r in p.refs if r.exists and r.relinked),
            "missing_count": len(p.missing),
            "missing": [r.expected_path or r.name for r in p.missing],
            "total_size": p.total_size,
            "mtime": p.mtime,  # for "recently modified" sorting in the UI
        })
    return out


def _emit(progress: ProgressCb, event: dict) -> None:
    if progress is not None:
        progress(event)


_backup_lock = threading.Lock()


def backup_in_progress() -> bool:
    """True while any backup is running — lets the scheduler skip overlapping ticks."""
    return _backup_lock.locked()


def run_backup(sources: list[Path], dest: Path, catalog: Catalog,
               timestamp: Optional[str] = None, progress: ProgressCb = None,
               als_paths: Optional[list[str]] = None, label: Optional[str] = None,
               portable: bool = False, layout: str = "project_date",
               find_missing: bool = False, libraries=None, should_cancel=None,
               mirrors=None) -> dict:
    """Serialize all backups process-wide, then run one.

    Only one backup may run at a time (manual or scheduled), so two runs can't race
    on the same snapshot folder and corrupt/lose it (audit: scheduler-vs-manual
    overlap). The actual work is in _run_backup_locked.
    """
    with _backup_lock:
        return _run_backup_locked(
            sources, dest, catalog, timestamp, progress, als_paths, label,
            portable, layout, find_missing, libraries, should_cancel, mirrors)


def _run_backup_locked(sources: list[Path], dest: Path, catalog: Catalog,
                       timestamp: Optional[str] = None, progress: ProgressCb = None,
                       als_paths: Optional[list[str]] = None, label: Optional[str] = None,
                       portable: bool = False, layout: str = "project_date",
                       find_missing: bool = False, libraries=None, should_cancel=None,
                       mirrors=None) -> dict:
    """Back up discovered projects to dest, recording history and emitting progress.

    When als_paths is given, only the projects whose .als matches are backed up
    (the user's include/exclude selection); otherwise every discovered project.
    label/portable/layout are the user's per-run choices from the review step.
    """
    base = Path(dest)
    timestamp = timestamp or default_timestamp()
    # Tell the UI we've started straight away — resolving projects can take a moment,
    # and a silent gap looks like nothing is happening.
    _emit(progress, {"type": "backup_preparing"})
    locate = _build_locator(sources, libraries) if find_missing else None
    if als_paths is not None:
        # Scan only the chosen projects (fast) rather than re-walking every source.
        projects = [scan_one(Path(a), locate=locate) for a in als_paths if Path(a).exists()]
    else:
        projects = scan_projects([Path(s) for s in sources], locate=locate)

    last_sigs = catalog.latest_signatures()
    ok_count = 0
    error_count = 0
    skipped_count = 0
    mirror_ok = 0
    mirror_failed = 0
    cancelled = False
    _emit(progress, {"type": "backup_start", "project_count": len(projects),
                     "timestamp": timestamp})
    for i, p in enumerate(projects):
        if should_cancel and should_cancel():
            cancelled = True
            break
        _emit(progress, {"type": "project_start", "index": i,
                         "project_name": p.name, "total": len(projects)})
        signature = project_signature(p, portable, layout)
        if last_sigs.get(p.project_id) == signature:
            # Identical to the last successful backup — don't make a redundant snapshot.
            skipped_count += 1
            _emit(progress, {"type": "project_skipped", "index": i, "project_name": p.name})
            continue
        # Per-DAW destination root, so FL and Ableton backups stay separate.
        adapter = adapter_for_id(p.daw_id)
        dest_root = base / (adapter.backup_root if adapter else "AbletonBackups")
        try:
            result = backup_project(p, dest_root, timestamp, portable=portable, layout=layout)
        except Exception as e:  # isolate one project's failure from the rest
            catalog.record_snapshot(
                project_name=p.name, timestamp=timestamp, total_size=0,
                file_count=0, status="error", missing=[], error=str(e), label=label,
                project_id=p.project_id, daw=p.daw_id,
            )
            error_count += 1
            _emit(progress, {"type": "project_error", "index": i,
                             "project_name": p.name, "error": str(e)})
            continue
        # Re-read the snapshot we just wrote to confirm every file actually landed
        # at the right size (catches truncated/failed writes, esp. over a NAS).
        v = verify_snapshot(result.snapshot_dir, deep=False)
        if not v["ok"]:
            status = "error"
            verr = v["error"] or f"{len(v['missing_files'])} missing, {len(v['bad_files'])} bad"
        else:
            status = "partial" if result.missing else "ok"
            verr = None
        catalog.record_snapshot(
            project_name=result.project_name, timestamp=result.timestamp,
            total_size=result.total_size, file_count=result.file_count,
            status=status, missing=result.missing, error=verr, label=label,
            dir=str(result.snapshot_dir), signature=signature,
            relinked_count=result.relinked_count,
            verified=1 if v["ok"] else 0, verified_at=timestamp,
            project_id=p.project_id, daw=p.daw_id,
        )
        ok_count += 1
        if mirrors:  # also copy this snapshot offsite (cloud/2nd drive)
            mok, mfail = mirror_snapshot(result.snapshot_dir, base, [str(m) for m in mirrors])
            mirror_ok += mok
            mirror_failed += mfail
        _emit(progress, {"type": "project_done", "index": i,
                         "project_name": result.project_name,
                         "file_count": result.file_count,
                         "missing_count": len(result.missing)})
    _emit(progress, {"type": "backup_done", "skipped_count": skipped_count,
                     "ok_count": ok_count, "error_count": error_count,
                     "mirror_failed": mirror_failed, "cancelled": cancelled})
    return {"timestamp": timestamp, "ok_count": ok_count,
            "error_count": error_count, "skipped_count": skipped_count,
            "mirror_ok": mirror_ok, "mirror_failed": mirror_failed,
            "cancelled": cancelled}
