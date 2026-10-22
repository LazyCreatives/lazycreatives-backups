"""Finding a NAS on the home network, logging in to it once, and connecting it again
by itself before each backup (a NAS that has gone to sleep can take a minute).

- Finding: NAS boxes (Synology, QNAP, TerraMaster, Asustor, a Mac or PC sharing a
  folder) announce their file sharing on the network with Bonjour/mDNS. On Windows,
  computers seen in the network list are added too.
- Shared folders: asked of the NAS itself over SMB, the way every computer talks to
  a NAS, with the login the producer typed.
- Connecting: the computer's own way, so the folder then works like any other:
  Windows "net use" (\\\\NAS\\Music), the Mac's own "mount volume" (/Volumes/Music),
  Linux "gio mount" (GNOME's Files) or an existing mount.
- The login is kept locked (secretbox.py), never in the Mac Keychain.

Backups only ever writes inside the folder the producer picks on the NAS.
"""
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

from ablebackup import secretbox
from ablebackup.catalog import Catalog

NAS_KEY = "nas"          # {"host", "address", "share", "user", "path", "name"}
SECRET_KEY = "nas_secret"
SUBDIR = "Lazy Creatives Backups"
_WIN = sys.platform == "win32"
_MAC = sys.platform == "darwin"

# What the network calls each kind of sharing, in the order people expect them.
_SERVICES = ("_smb._tcp.local.", "_afpovertcp._tcp.local.", "_adisk._tcp.local.")
_MODEL_SERVICE = "_device-info._tcp.local."
_MAKERS = (("synology", "Synology"), ("qnap", "QNAP"), ("tnas", "TerraMaster"),
           ("terramaster", "TerraMaster"), ("asustor", "Asustor"), ("wd", "WD"),
           ("mycloud", "WD"), ("ugreen", "UGREEN"), ("truenas", "TrueNAS"),
           ("unraid", "Unraid"), ("netgear", "Netgear"), ("readynas", "Netgear"))


class NasError(Exception):
    """A plain-English reason for the screen ("That password didn't work")."""


def _run(args: list[str], timeout: float = 30, stdin: str | None = None) -> subprocess.CompletedProcess:
    kw = {"creationflags": 0x08000000} if _WIN else {}  # no console window on Windows
    return subprocess.run(args, input=stdin, capture_output=True, text=True, timeout=timeout, **kw)


# ---- finding -----------------------------------------------------------------
def maker_of(name: str, model: str = "") -> str:
    s = f"{name} {model}".lower()
    for key, maker in _MAKERS:
        if key in s:
            return maker
    if "macmini" in s or "macbook" in s or "imac" in s or model.lower().startswith("mac"):
        return "Mac"
    return ""


def discover(seconds: float = 3.0) -> list[dict]:
    """Every file server announcing itself on the network: {name, host, address,
    maker}. Takes a few seconds; an empty list when nothing answers or the network
    can't be listened to."""
    found: dict[str, dict] = {}
    try:
        from zeroconf import ServiceBrowser, ServiceListener, Zeroconf
    except ImportError:
        Zeroconf = None
    if Zeroconf is not None:
        names: set[tuple[str, str]] = set()

        class _L(ServiceListener):
            def add_service(self, zc, type_, name):
                names.add((type_, name))

            def update_service(self, zc, type_, name):
                names.add((type_, name))

            def remove_service(self, zc, type_, name):
                pass

        zc = None
        try:
            zc = Zeroconf()
            ServiceBrowser(zc, list(_SERVICES) + [_MODEL_SERVICE], _L())
            time.sleep(seconds)
            models: dict[str, str] = {}
            for type_, name in sorted(names):
                info = zc.get_service_info(type_, name, timeout=800)
                label = name[: -len(type_) - 1] if name.endswith(type_) else name
                if type_ == _MODEL_SERVICE:
                    if info:
                        model = (info.properties or {}).get(b"model", b"") or b""
                        models[label.lower()] = model.decode("utf-8", "replace")
                    continue
                if not info:
                    continue
                host = (info.server or "").rstrip(".")
                addrs = info.parsed_addresses() if hasattr(info, "parsed_addresses") else []
                v4 = [a for a in addrs if ":" not in a]
                key = host.lower() or label.lower()
                if key in found:
                    continue
                found[key] = {"name": label, "host": host or (v4[0] if v4 else label),
                              "address": v4[0] if v4 else (addrs[0] if addrs else ""),
                              "maker": ""}
            for f in found.values():
                f["maker"] = maker_of(f["name"], models.get(f["name"].lower(), ""))
        except Exception:
            pass  # no network, or listening isn't allowed: the address box still works
        finally:
            if zc is not None:
                try:
                    zc.close()
                except Exception:
                    pass
    if _WIN:
        for name in _windows_network_list():
            if name.lower() not in {f["name"].lower() for f in found.values()}:
                found[name.lower()] = {"name": name, "host": name, "address": "", "maker": maker_of(name)}
    # This computer itself isn't a NAS to back up to.
    me = socket.gethostname().split(".")[0].lower()
    out = [f for f in found.values() if f["name"].split(".")[0].lower() != me]
    return sorted(out, key=lambda f: (f["maker"] == "", f["name"].lower()))


def _windows_network_list() -> list[str]:
    try:
        r = _run(["net", "view"], timeout=8)
    except (OSError, subprocess.SubprocessError):
        return []
    return [m.group(1) for m in re.finditer(r"^\\\\(\S+)", r.stdout, re.M)]


def clean_host(text: str) -> str:
    """What people paste: "\\\\NAS\\Music", "smb://192.168.1.20/Music", "nas.local",
    "TNAS". Returns the host part only."""
    s = (text or "").strip().strip('"')
    s = re.sub(r"^(smb|cifs|afp)://", "", s, flags=re.I)
    s = s.lstrip("\\/").replace("\\", "/")
    s = s.split("/")[0]
    s = s.split("@")[-1]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.\-_]{0,252}", s or ""):
        raise NasError("That doesn't look like a NAS name or address. Try something like 192.168.1.20 or tnas.local.")
    return s


def share_in(text: str) -> str:
    """The shared folder named in a pasted address, if any ("\\\\NAS\\Music" -> "Music")."""
    s = re.sub(r"^(smb|cifs|afp)://", "", (text or "").strip().strip('"'), flags=re.I)
    parts = [p for p in s.replace("\\", "/").split("/") if p]
    return parts[1] if len(parts) > 1 else ""


# ---- shared folders ----------------------------------------------------------
def _resolve(host: str) -> str:
    try:
        return socket.gethostbyname(host)
    except OSError:
        raise NasError(f"Couldn't find {host} on the network. Check it's switched on and on the same network.") from None


def list_shares(host: str, user: str, password: str) -> list[dict]:
    """The NAS's shared folders this login can see: [{name, comment}]."""
    from smb.SMBConnection import SMBConnection
    ip = _resolve(host)
    conn = SMBConnection(user or "guest", password or "", "lazycreatives", host.split(".")[0].upper(),
                         use_ntlm_v2=True, is_direct_tcp=True)
    try:
        ok = conn.connect(ip, 445, timeout=10)
    except (OSError, socket.timeout):
        raise NasError(f"No answer from {host}. If it's asleep, give it a minute and try again.") from None
    except Exception:
        ok = False
    if not ok:
        raise NasError("That name or password didn't work on the NAS.")
    try:
        shares = conn.listShares(timeout=15)
    except Exception:
        raise NasError("Logged in, but the NAS wouldn't list its shared folders.") from None
    finally:
        try:
            conn.close()
        except Exception:
            pass
    out = []
    for s in shares:
        if getattr(s, "isSpecial", False) or s.name.endswith("$") or getattr(s, "isTemporary", False):
            continue
        if getattr(s, "type", 0) not in (0, getattr(s, "DISK_TREE", 0)):
            continue
        out.append({"name": s.name, "comment": (s.comments or "").strip()})
    return sorted(out, key=lambda s: s["name"].lower())


# ---- connecting --------------------------------------------------------------
def _as_script(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def mount_path(host: str, share: str) -> Path | None:
    """Where this share is already connected on this computer, if it is."""
    if _WIN:
        p = Path(f"\\\\{host}\\{share}")
        return p if _quick_isdir(p) else None
    try:
        out = _run(["mount"], timeout=8).stdout
    except (OSError, subprocess.SubprocessError):
        out = ""
    h, sh = host.lower(), share.lower()
    for line in out.splitlines():
        m = re.match(r"^(?://|)(?:[^@\s]*@)?([^/\s]+)/(\S+) on (.+?) (?:\(|type )", line)
        if m and m.group(1).lower().split(".")[0] in (h, h.split(".")[0]) \
                and m.group(2).replace("%20", " ").lower() == sh:
            return Path(m.group(3))
    if not _MAC:  # GNOME's Files
        gvfs = Path(f"/run/user/{os.getuid()}/gvfs/smb-share:server={h},share={sh}")
        if _quick_isdir(gvfs):
            return gvfs
    return None


def _quick_isdir(p: Path, timeout: float = 4.0) -> bool:
    """Is the folder there? Never hangs on a sleeping network share."""
    import threading
    box: list[bool] = []
    t = threading.Thread(target=lambda: box.append(os.path.isdir(p)), daemon=True)
    t.start()
    t.join(timeout)
    return bool(box and box[0])


def connect(host: str, share: str, user: str, password: str) -> Path:
    """Connect the shared folder the computer's own way and return its path."""
    already = mount_path(host, share)
    if already:
        return already
    try:
        if _WIN:
            unc = f"\\\\{host}\\{share}"
            args = ["net", "use", unc]
            if user:
                args += [password, f"/user:{user}"]
            r = _run(args + ["/persistent:yes"], timeout=60)
            if r.returncode != 0 and "1219" not in (r.stdout + r.stderr):  # 1219: already connected
                raise NasError(_win_error(r.stdout + r.stderr))
            return Path(unc)
        if _MAC:
            url = f"smb://{host}/{share}"
            script = f'mount volume "{_as_script(url)}"'
            if user:
                script += f' as user name "{_as_script(user)}" with password "{_as_script(password)}"'
            r = _run(["osascript", "-e", script], timeout=90)
            if r.returncode != 0:
                raise NasError("The Mac couldn't connect that folder. Check the name and password.")
        else:
            r = _run(["gio", "mount", f"smb://{host}/{share}"], timeout=90,
                     stdin=f"{user}\nWORKGROUP\n{password}\n")
            if r.returncode != 0 and "already mounted" not in r.stderr.lower():
                raise NasError("Couldn't connect that folder. Check the name and password.")
    except FileNotFoundError:
        raise NasError("This computer has no way to connect network folders from here. "
                       "Connect it in your file manager, then pick it with Choose….") from None
    except subprocess.TimeoutExpired:
        raise NasError(f"No answer from {host} in time. If it's asleep, give it a minute and try again.") from None
    for _ in range(20):  # the folder can take a moment to appear
        p = mount_path(host, share)
        if p:
            return p
        time.sleep(0.5)
    raise NasError("Connected, but the folder didn't show up on this computer.")


def _win_error(text: str) -> str:
    if "86" in text or "1326" in text:
        return "That name or password didn't work on the NAS."
    if "53" in text or "67" in text:
        return "Couldn't find that NAS or folder on the network."
    return "Windows couldn't connect that folder."


# ---- remembered NAS ------------------------------------------------------------
def _key_dir(catalog: Catalog) -> Path:
    return Path(getattr(catalog, "path", Path.home())).parent


def remember(catalog: Catalog, *, host: str, address: str, share: str, user: str,
             password: str, path: Path, name: str = "") -> None:
    catalog.set_setting(NAS_KEY, {"host": host, "address": address, "share": share, "user": user,
                                  "path": str(path), "name": name or host})
    catalog.set_setting(SECRET_KEY, secretbox.lock(password, _key_dir(catalog)) if password else None)


def forget(catalog: Catalog) -> None:
    catalog.set_setting(NAS_KEY, None)
    catalog.set_setting(SECRET_KEY, None)


def remembered(catalog: Catalog) -> dict | None:
    n = catalog.get_setting(NAS_KEY)
    return n if isinstance(n, dict) and n.get("host") else None


def on_nas(catalog: Catalog, dest) -> dict | None:
    """The remembered NAS, if the backup folder is on it."""
    n = remembered(catalog)
    if not n or not dest:
        return None
    try:
        Path(dest).relative_to(n["path"])
    except ValueError:
        return None
    return n


def ensure_connected(catalog: Catalog, dest, wait: float = 75.0, step: float = 5.0) -> bool:
    """Before a backup: if the backup folder is on the remembered NAS and isn't
    there, connect it again with the saved login, waiting while the NAS wakes up.
    True when the folder is there (or isn't on a NAS at all: nothing to do)."""
    n = on_nas(catalog, dest)
    if not n or _quick_isdir(Path(dest)):
        return True
    password = secretbox.unlock(catalog.get_setting(SECRET_KEY), _key_dir(catalog)) or ""
    deadline = time.monotonic() + wait
    while True:
        try:
            path = connect(n["host"], n["share"], n.get("user", ""), password)
            if str(path) != n["path"]:
                # Connected somewhere new ("/Volumes/Music-1"): follow it.
                _moved(catalog, n, path)
            if _quick_isdir(Path(catalog_dest(catalog) or dest)):
                return True
        except NasError:
            pass
        if time.monotonic() >= deadline:
            return False
        time.sleep(step)


def catalog_dest(catalog: Catalog) -> str:
    return (catalog.get_setting("config") or {}).get("dest", "")


def _moved(catalog: Catalog, n: dict, path: Path) -> None:
    cfg = catalog.get_setting("config") or {}
    dest = cfg.get("dest", "")
    try:
        rel = Path(dest).relative_to(n["path"])
    except ValueError:
        return
    cfg["dest"] = str(path / rel)
    catalog.set_setting("config", cfg)
    catalog.set_setting(NAS_KEY, {**n, "path": str(path)})


# ---- a NAS away from home --------------------------------------------------------
# Tailscale joins this computer and the NAS into one private network wherever each
# one is, so the NAS shows up and connects exactly as it does at home. Backups only
# reads what the Tailscale app on this computer says; it never changes its settings.
_TAILSCALE_PLACES = {
    "darwin": ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale",
               "/opt/homebrew/bin/tailscale"],
    "win32": [r"C:\Program Files\Tailscale\tailscale.exe"],
}
_NOT_NAS_OS = {"ios", "android", "tvos"}


def tailscale_cli() -> str | None:
    import shutil
    found = shutil.which("tailscale")
    if found:
        return found
    for p in _TAILSCALE_PLACES.get(sys.platform, []):
        if Path(p).is_file():
            return p
    return None


def tailscale() -> dict:
    """{installed, running, peers: [{name, host, address, maker, away}]}: the other
    computers on this Tailscale network that are switched on, phones left out."""
    import json
    cli = tailscale_cli()
    if not cli:
        return {"installed": False, "running": False, "peers": []}
    try:
        r = _run([cli, "status", "--json"], timeout=8)
        data = json.loads(r.stdout or "{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        return {"installed": True, "running": False, "peers": []}
    running = data.get("BackendState") == "Running"
    peers = []
    for p in (data.get("Peer") or {}).values():
        if not p.get("Online") or (p.get("OS") or "").lower() in _NOT_NAS_OS:
            continue
        ips = [i for i in p.get("TailscaleIPs") or [] if ":" not in i]
        name = p.get("HostName") or (p.get("DNSName") or "").split(".")[0]
        host = (p.get("DNSName") or "").rstrip(".") or (ips[0] if ips else name)
        peers.append({"name": name, "host": host, "address": ips[0] if ips else "",
                      "maker": maker_of(name), "away": True})
    return {"installed": True, "running": running,
            "peers": sorted(peers, key=lambda f: f["name"].lower()) if running else []}


# The fallback with no extra app: the NAS's own internet address over SFTP or WebDAV,
# set up as a second place every backup is copied to (a full copy each time; space
# saving needs the NAS to look like a folder on this computer, which Tailscale gives).
REMOTE_KINDS = {"sftp": 22, "webdav": 5006}


def add_remote(kind: str, host: str, port: int | None, user: str, password: str,
               folder: str, rclone: str | None, taken: list[str]) -> str:
    """Make an rclone remote for the NAS, check it answers, and return the place to
    copy backups to ("tnas:Music/LazyCreatives-Backups")."""
    from ablebackup.service import safe_remote_name
    if kind not in REMOTE_KINDS:
        raise NasError("Pick SFTP or WebDAV.")
    if not rclone:
        raise NasError("This needs the free rclone helper. Install it, then try again.")
    host = clean_host(host)
    port = int(port or REMOTE_KINDS[kind])
    name = safe_remote_name(host.split(".")[0], taken)
    if kind == "sftp":
        opts = [f"host={host}", f"port={port}", f"user={user}", f"pass={password}"]
    else:
        opts = [f"url=https://{host}:{port}", "vendor=other", f"user={user}", f"pass={password}"]
    try:
        r = _run([rclone, "config", "create", name, kind, *opts, "--obscure", "--non-interactive"], timeout=30)
        if r.returncode != 0:
            raise NasError("Couldn't save that NAS address.")
        where = f"{name}:{folder.strip().strip('/')}/LazyCreatives-Backups" if folder.strip().strip("/") \
            else f"{name}:LazyCreatives-Backups"
        t = _run([rclone, "mkdir", where, "--contimeout", "15s", "--timeout", "30s"], timeout=60)
        if t.returncode != 0:
            _run([rclone, "config", "delete", name], timeout=15)
            raise NasError(f"Backups couldn't get in to {host}. Check the address, port, user name and "
                           "password, and that the router lets it through.")
    except subprocess.TimeoutExpired:
        _run([rclone, "config", "delete", name], timeout=15)
        raise NasError(f"No answer from {host} over the internet in time.") from None
    return where
