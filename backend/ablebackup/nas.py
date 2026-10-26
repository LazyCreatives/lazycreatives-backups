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


class NasLoginError(NasError):
    """The NAS turned the name and password down: signing in again is the way out."""


LOGIN_REFUSED = "That name or password didn't work on the NAS."


def _run(args: list[str], timeout: float = 30, stdin: str | None = None,
         encoding: str | None = None) -> subprocess.CompletedProcess:
    kw = {"creationflags": 0x08000000} if _WIN else {}  # no console window on Windows
    return subprocess.run(args, input=stdin, capture_output=True, text=True, timeout=timeout,
                          encoding=encoding, errors="replace", **kw)


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


def split_user(user: str) -> tuple[str, str]:
    """("TNAS\\robert" or "robert@TNAS") -> ("TNAS", "robert"); a plain name has no domain."""
    u = (user or "").strip()
    if "\\" in u:
        d, _, n = u.partition("\\")
        return d.strip(), n.strip()
    if "@" in u and "." not in u.split("@", 1)[1]:  # robert@TNAS, not an email address
        n, _, d = u.partition("@")
        return d.strip(), n.strip()
    return "", u


def _table(text: str, last_is_summary: bool) -> list[dict]:
    """Rows of the share table that "smbutil view" (Mac) and "net view" (Windows) print:
    a header, a line of dashes, then name / type / comment in fixed columns."""
    lines = (text or "").splitlines()
    dash = next((i for i, l in enumerate(lines) if re.match(r"^\s*-{8,}\s*$", l)), None)
    if dash is None:
        return []
    head = next((lines[i] for i in range(dash - 1, -1, -1) if lines[i].strip()), "")
    words = list(re.finditer(r"\S+(?: \S+)*", head))
    type_col = words[1].start() if len(words) > 1 else 0
    note_col = words[-1].start() if len(words) > 2 else 0
    rows = [l for l in lines[dash + 1:] if l.strip()]
    if last_is_summary and rows:
        rows = rows[:-1]  # "3 shares listed" / "The command completed successfully."
    out = []
    for l in rows:
        name = l[:type_col].strip() if type_col else l.split()[0]
        rest = l[type_col:].split() if type_col else l.split()[1:]
        kind = rest[0].lower() if rest else ""
        if not name or name.endswith("$") or kind in ("pipe", "ipc", "print", "printq", "drucker"):
            continue
        comment = l[note_col:].strip() if note_col and len(l) > note_col else ""
        out.append({"name": name, "comment": comment})
    return out


def _list_native(host: str, user: str, password: str) -> list[dict] | None:
    """Ask the computer's own file sharing for the NAS's shared folders: it speaks every
    SMB version the NAS might insist on. None when it can't be asked this way."""
    from urllib.parse import quote
    domain, name = split_user(user)
    try:
        if _MAC:
            who = (quote(domain, safe="") + ";" if domain else "") + \
                (quote(name, safe="") + ":" + quote(password or "", safe="") + "@" if name else "")
            r = _run(["smbutil", "view", f"//{who}{host}"], timeout=40)
            text = r.stdout + r.stderr
            if r.returncode != 0:
                if re.search(r"authenticat|rejected|permission|password", text, re.I):
                    raise NasLoginError(LOGIN_REFUSED)
                return None
            return _table(r.stdout, last_is_summary=True)
        if _WIN:
            ipc = f"\\\\{host}\\IPC$"
            users = [user.strip()] if not name or domain else [name, f"{host.split('.')[0]}\\{name}"]
            joined = False
            for u in users:
                args = ["net", "use", ipc] + ([password, f"/user:{u}"] if u else []) + ["/persistent:no"]
                r = _run(args, timeout=40)
                code = _win_code(r.stdout + r.stderr)
                if r.returncode == 0 or code == 1219:  # 1219: already connected with a login
                    joined = r.returncode == 0
                    break
                if code not in (86, 1326):
                    return None
            else:
                raise NasLoginError(LOGIN_REFUSED)
            try:
                r = _run(["net", "view", f"\\\\{host}"], timeout=40)
                return _table(r.stdout, last_is_summary=True) if r.returncode == 0 else None
            finally:
                if joined:
                    _run(["net", "use", ipc, "/delete", "/y"], timeout=20)
    except (OSError, subprocess.SubprocessError):
        return None
    return None


def list_shares(host: str, user: str, password: str) -> list[dict] | None:
    """The NAS's shared folders this login can see: [{name, comment}].

    None when the NAS took the login but wouldn't talk about its folders in a way this
    app understands (some NAS boxes only speak newer SMB): the user then types the
    folder's name and the computer's own connect checks the login instead. A wrong
    login is only reported when the NAS itself turned it down."""
    native = _list_native(host, user, password)
    if native:
        return native
    from smb.SMBConnection import SMBConnection
    ip = _resolve(host)
    domain, name = split_user(user)
    nas_name = host.split(".")[0].upper() if not re.search(r"^[\d.]+$|:", host) else ""
    # Some NAS boxes only accept the login with their workgroup or own name in front.
    domains = list(dict.fromkeys([domain, "WORKGROUP", nas_name] if not domain else [domain]))
    conn = None
    refused = False
    for d in domains:
        c = SMBConnection(name or "guest", password or "", "lazycreatives", nas_name or "NAS",
                          domain=d, use_ntlm_v2=True, is_direct_tcp=True)
        try:
            if c.connect(ip, 445, timeout=10):
                conn = c
                break
            refused = True
        except (OSError, socket.timeout):
            raise NasError(f"No answer from {host}. If it's asleep, give it a minute and try again.") from None
        except Exception:
            return None
        finally:
            if conn is not c:
                try:
                    c.close()
                except Exception:
                    pass
    if conn is None:
        if refused:
            raise NasLoginError(LOGIN_REFUSED)
        return None
    try:
        shares = conn.listShares(timeout=15)
    except Exception:
        return None
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


def folder_name(text: str) -> str:
    """The folder Backups makes inside the shared folder: what the producer typed,
    made safe for every computer, or "Lazy Creatives Backups"."""
    t = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", text or "").strip().strip(".").strip()
    return re.sub(r"\s+", " ", t)[:80] or SUBDIR


# Which shared folder Backups tries first when it picks one by itself.
_SHARE_LIKES = (r"backup", r"music|audio|studio|project|sound|record", r"media|data|share|public|files|storage")
_SHARE_DISLIKES = r"time ?machine|photo|picture|video|movie|film|tv|download|web|docker|home|surveillance|usb"


def share_order(shares: list[dict]) -> list[str]:
    """The NAS's shared folders, the likeliest place for music backups first."""
    def rank(name: str) -> int:
        low = name.lower()
        for i, pat in enumerate(_SHARE_LIKES):
            if re.search(pat, low):
                return i
        return len(_SHARE_LIKES) + (1 if re.search(_SHARE_DISLIKES, low) else 0)
    def natural(name: str):  # "Share 2" before "Share 10"
        return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name.casefold())]
    return [s["name"] for s in sorted(shares, key=lambda s: (rank(s["name"]), natural(s["name"])))]


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
            domain, name = split_user(user)
            users = [user.strip()] if not user.strip() or domain else \
                [name, f"{host.split('.')[0]}\\{name}"]  # some NAS boxes want TNAS\robert
            for u in users:
                args = ["net", "use", unc] + ([password, f"/user:{u}"] if u else [])
                r = _run(args + ["/persistent:yes"], timeout=60)
                code = _win_code(r.stdout + r.stderr)
                if code == 1219 and not _quick_isdir(Path(unc)):
                    # 1219: Windows is already joined to this NAS, but that old link
                    # doesn't get in any more (the NAS turned its login down, or it
                    # was made with another name). Let it go and sign in afresh.
                    _drop_links(host)
                    r = _run(args + ["/persistent:yes"], timeout=60)
                    code = _win_code(r.stdout + r.stderr)
                if r.returncode == 0 or code == 1219:  # 1219: already connected
                    return Path(unc)
                if code not in (86, 1326):
                    break
            if code in (86, 1326):
                raise NasLoginError(LOGIN_REFUSED)
            raise NasError((code == 67 and _no_such_share(host, share, user, password)) or _win_error(code))
        if _MAC:
            url = f"smb://{host}/{share}"
            script = f'mount volume "{_as_script(url)}"'
            if user.strip():
                script += f' as user name "{_as_script(user.strip())}" with password "{_as_script(password)}"'
            r = _run(["osascript", "-e", script], timeout=90)
            if r.returncode != 0:
                raise NasError(_no_such_share(host, share, user, password)
                               or "The Mac couldn't connect that folder. Check the name and password.")
        else:
            domain, name = split_user(user)
            r = _run(["gio", "mount", f"smb://{host}/{share}"], timeout=90,
                     stdin=f"{name}\n{domain or 'WORKGROUP'}\n{password}\n")
            if r.returncode != 0 and "already mounted" not in r.stderr.lower():
                raise NasError(_no_such_share(host, share, user, password)
                               or "Couldn't connect that folder. Check the name and password.")
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


def _drop_links(host: str) -> None:
    """Let go of Windows's links to this NAS that have no drive letter (the ones apps
    like this make). A drive letter the producer set up in File Explorer is left alone."""
    try:
        out = _run(["net", "use"], timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return
    for unc in links_to(host, out):
        _run(["net", "use", unc, "/delete", "/y"], timeout=20)


def links_to(host: str, net_use: str) -> list[str]:
    """The \\\\NAS\\folder links in what "net use" lists that have no drive letter."""
    found = []
    for line in net_use.splitlines():
        m = re.search(r"(\\\\[^\\\s]+\\\S.*?)(?=\s{2,}|\s*$)", line)  # a name can have spaces
        if not m or m.group(1)[2:].split("\\")[0].lower() != host.lower():
            continue
        if re.search(r"(?<![\w\\])[A-Za-z]:(?!\S)", line[:m.start()]):
            continue  # a drive letter (Z:): the producer's own
        found.append(m.group(1))
    return found


def _no_such_share(host: str, share: str, user: str, password: str) -> str | None:
    """When the folder typed isn't one of the NAS's shared folders, say so and name them."""
    try:
        shares = [x["name"] for x in (list_shares(host, user, password) or [])]
    except NasError:
        return None
    if not shares or share.lower() in (x.lower() for x in shares):
        return None
    some = ", ".join(shares[:4]) + (" and others" if len(shares) > 4 else "")
    return (f"{host.split('.')[0]} has no shared folder called {share}. Its shared folders are {some}: "
            "pick one, and Backups makes its own folder inside it.")


def _win_code(text: str) -> int | None:
    """The number in "System error 1326 has occurred." (the words change with the language)."""
    m = re.search(r"(?<![\d.])(\d{1,10})(?![\d.])", text or "")  # not part of an address
    return int(m.group(1)) if m else None


def _win_error(code: int | None) -> str:
    if code in (86, 1326):
        return LOGIN_REFUSED
    if code in (53, 67):
        return "Couldn't find that NAS or folder on the network."
    if code == 5:
        return "This login isn't allowed into that shared folder. Pick another, or log in as someone who can."
    return f"Windows couldn't connect that folder (error {code})." if code else "Windows couldn't connect that folder."


# ---- remembered NAS ------------------------------------------------------------
def _key_dir(catalog: Catalog) -> Path:
    return Path(getattr(catalog, "path", Path.home())).parent


def remember(catalog: Catalog, *, host: str, address: str, share: str, user: str,
             password: str, path: Path, name: str = "") -> None:
    before = remembered(catalog) or {}
    shares = before.get("shares", {}) if before.get("host") == host else {}
    catalog.set_setting(NAS_KEY, {"host": host, "address": address, "share": share, "user": user,
                                  "path": str(path), "name": name or host, "shares": shares})
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


# ---- project folders on the NAS ----------------------------------------------------
# The producer can keep projects and samples on the NAS too (picked with Add folder,
# see before_pick and adopt). Backups connects those shared folders with the saved login,
# before a scan or backup and before opening a project from it, exactly as it does
# for the backup folder. It only ever reads them.
def _password(catalog: Catalog) -> str:
    return secretbox.unlock(catalog.get_setting(SECRET_KEY), _key_dir(catalog)) or ""


# ---- the computer's own folder picker -----------------------------------------------
# Every "Add folder" / "Choose…" opens the computer's own folder picker. That picker
# only gets into the NAS if this computer has the NAS login, which Backups keeps
# itself, so Windows said it couldn't connect. Before a picker opens, Backups lets the
# computer in with the saved login; after a folder on the NAS is picked, its shared
# folder is remembered, so it's connected again by itself when the NAS wakes.
def before_pick(catalog: Catalog) -> dict:
    """Let this computer into the remembered NAS, so its folder picker can open it."""
    n = remembered(catalog)
    if not n:
        return {"nas": False}
    user, password = n.get("user", ""), _password(catalog)
    try:
        if _WIN:
            # Windows signs in once per NAS name: the name Backups knows and its
            # address (typed in the picker as \\100.90.248.35) are two names.
            for host in dict.fromkeys(h for h in (n["host"], n.get("address", "")) if h):
                try:
                    connect(host, n["share"], user, password)
                except NasLoginError:
                    raise
                except NasError:
                    continue
        else:  # Mac and Linux: connect its shared folders, so the picker lists them
            names = share_order(list_shares(n["host"], user, password) or []) or [n["share"]]
            for share in names[:8]:
                try:
                    connect(n["host"], share, user, password)
                except NasLoginError:
                    raise
                except NasError:
                    continue
    except NasLoginError:
        return {"nas": True, "login": True}
    except NasError:
        pass
    return {"nas": True, "login": False}


_MOUNT_ROOTS = ("/Volumes/", "/run/user/", "/media/", "/mnt/")


def _picked_share(names: set[str], path: str) -> tuple[str, str] | None:
    """(shared folder, where it's connected) for a folder picked on the NAS, or None."""
    m = re.match(r"^(?:\\\\|//)([^\\/]+)[\\/]+([^\\/]+)", path)
    if m:  # Windows: \\NAS\share\...
        if m.group(1).lower() in names:
            return m.group(2), f"\\\\{m.group(1)}\\{m.group(2)}"
        return None
    if not path.startswith(_MOUNT_ROOTS):
        return None
    g = re.search(r"/gvfs/smb-share:server=([^,/]+),share=([^,/]+)", path)
    if g:
        if g.group(1).lower() in names:
            return g.group(2), path[:g.end()]
        return None
    try:
        out = _run(["mount"], timeout=8).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    best = None
    for line in out.splitlines():
        mm = re.match(r"^(?://|)(?:[^@\s]*@)?([^/\s]+)/(\S+) on (.+?) (?:\(|type )", line)
        if not mm or mm.group(1).lower() not in names and mm.group(1).lower().split(".")[0] not in names:
            continue
        where = mm.group(3)
        if (path == where or path.startswith(where.rstrip("/") + "/")) and (not best or len(where) > len(best[1])):
            best = (mm.group(2).replace("%20", " "), where)
    return best


def adopt(catalog: Catalog, paths) -> list[str]:
    """Folders picked on the NAS: remember their shared folders. Returns the ones added."""
    n = remembered(catalog)
    if not n:
        return []
    names = {x.lower() for x in (n["host"], n["host"].split(".")[0], n.get("address", "")) if x}
    shares = dict(n.get("shares") or {})
    added = []
    for p in paths:
        if not p or _share_for({**n, "shares": shares}, str(p)):
            continue
        hit = _picked_share(names, str(p))
        if hit and hit[0] not in shares:
            shares[hit[0]] = hit[1]
            added.append(hit[0])
    if added:
        catalog.set_setting(NAS_KEY, {**n, "shares": shares})
    return added


def _share_for(n: dict, path: str) -> tuple[str, str] | None:
    """(shared folder, where it's connected) that holds this path."""
    places = {n.get("share", ""): n.get("path", ""), **(n.get("shares") or {})}
    for share, mount in places.items():
        if not share or not mount:
            continue
        try:
            Path(path).relative_to(mount)
        except ValueError:
            continue
        return share, mount
    return None


def on_nas_path(catalog: Catalog, path) -> bool:
    n = remembered(catalog)
    return bool(n and path and _share_for(n, str(path)))


def ensure_folders(catalog: Catalog, paths, wait: float = 45.0, step: float = 5.0,
                   moved: dict | None = None, why: dict | None = None) -> list[str]:
    """Connect the NAS shared folders these folders are on, if they aren't there,
    waiting while the NAS wakes. Folders that came back at a new path ("Music-1")
    are followed in Settings, and put in ``moved`` (old mount -> new) so the caller
    can follow its own copies with ``follow``. Returns the folders (as they are now)
    still missing; ``why`` gets each shared folder that couldn't be connected and the
    NasError that said why. A turned-down login isn't waited out: it won't change."""
    moved = {} if moved is None else moved
    why = {} if why is None else why
    n = remembered(catalog)
    paths = [str(p) for p in paths if p]
    if not n:
        return []
    need: dict[str, str] = {}
    for p in paths:
        hit = _share_for(n, p)
        if hit and not _quick_isdir(Path(p)):
            need[hit[0]] = hit[1]
    if not need:
        return []
    password = _password(catalog)
    deadline = time.monotonic() + wait
    left = dict(need)
    while left:
        for share, mount in list(left.items()):
            try:
                new = connect(n["host"], share, n.get("user", ""), password)
            except NasLoginError as e:
                why[share] = e
                del left[share]
                continue
            except NasError as e:
                why[share] = e
                continue
            why.pop(share, None)
            del left[share]
            if str(new) != mount:
                _share_moved(catalog, share, mount, str(new))
                moved[mount] = str(new)
        if not left or time.monotonic() >= deadline:
            break
        time.sleep(step)

    return [q for q in follow(paths, moved) if _share_for(remembered(catalog) or n, q) and not _quick_isdir(Path(q))]


def sign_in(catalog: Catalog, user: str, password: str) -> None:
    """Log in to the remembered NAS again (this computer was turned down with the saved
    login, or the password changed on the NAS). The new login is kept once one of its
    shared folders lets it in."""
    n = remembered(catalog)
    if not n:
        raise NasError("Connect your NAS first: Settings, Backups, Find my NAS.")
    shares = [n.get("share", "")] + [s for s in (n.get("shares") or {}) if s != n.get("share")]
    last: NasError = NasLoginError(LOGIN_REFUSED)
    for share in [s for s in shares if s]:
        try:
            connect(n["host"], share, user, password)
        except NasLoginError as e:
            raise e from None  # the same login won't work on the next folder either
        except NasError as e:
            last = e
            continue
        catalog.set_setting(NAS_KEY, {**n, "user": user})
        catalog.set_setting(SECRET_KEY, secretbox.lock(password, _key_dir(catalog)) if password else None)
        return
    raise last


def follow(paths, moved: dict):
    """The same paths after shared folders came back at new mounts (from ensure_folders)."""
    def now(p):
        for old, new in moved.items():
            try:
                return type(p)(Path(new) / Path(p).relative_to(old))
            except ValueError:
                pass
        return p
    return [now(p) for p in paths]


def _share_moved(catalog: Catalog, share: str, old: str, new: str) -> None:
    n = remembered(catalog) or {}
    if share == n.get("share"):
        _moved(catalog, n, Path(new))
        n = remembered(catalog) or n
    if share in (n.get("shares") or {}):
        n = {**n, "shares": {**n["shares"], share: new}}
    catalog.set_setting(NAS_KEY, n)
    cfg = catalog.get_setting("config") or {}

    def follow(p: str) -> str:
        try:
            return str(Path(new) / Path(p).relative_to(old))
        except ValueError:
            return p
    cfg["sources"] = [follow(p) for p in cfg.get("sources") or []]
    if cfg.get("libraries"):  # sample folders on the same shared folder
        cfg["libraries"] = [follow(p) for p in cfg["libraries"]]
    catalog.set_setting("config", cfg)


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
    catalog.move_dirs(n["path"], str(path))  # its backups moved with it
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
    """{installed, running, peers: [{name, host, address, maker, away, via?}]}: the
    computers on this Tailscale network that are switched on and share files, and the
    ones on a home network another computer shares over Tailscale (via: its name)."""
    import json
    cli = tailscale_cli()
    if not cli:
        return {"installed": False, "running": False, "peers": []}
    try:
        # Tailscale writes UTF-8 whatever the Windows language: a device called
        # "Robert’s iPhone" must not stop the whole list from being read.
        r = _run([cli, "status", "--json"], timeout=8, encoding="utf-8")
        data = json.loads(r.stdout or "{}")
    except (OSError, subprocess.SubprocessError, ValueError):
        return {"installed": True, "running": False, "peers": []}
    running = data.get("BackendState") == "Running"
    if not running:
        return {"installed": True, "running": False, "peers": []}
    peers = []
    routes: list[tuple[str, str]] = []  # (home network, the computer that shares it)
    for p in (data.get("Peer") or {}).values():
        if not p.get("Online"):
            continue
        name = p.get("HostName") or (p.get("DNSName") or "").split(".")[0]
        # A computer at home can share its whole home network over Tailscale (a
        # "subnet router"): the NAS on it is then reachable without Tailscale on the NAS.
        routes += [(r, name) for r in p.get("PrimaryRoutes") or [] if ":" not in r]
        if (p.get("OS") or "").lower() in _NOT_NAS_OS:
            continue
        ips = [i for i in p.get("TailscaleIPs") or [] if ":" not in i]
        host = (p.get("DNSName") or "").rstrip(".") or (ips[0] if ips else name)
        peers.append({"name": name, "host": host, "address": ips[0] if ips else "",
                      "maker": maker_of(name), "away": True})
    # Only the ones that share files (a NAS, not every laptop on the Tailscale network).
    # Away from home the first answer can come the long way round (through Tailscale's
    # relays) while the direct route is found, so they get longer than at home; and a
    # NAS-maker's box is kept even when it was slow to answer.
    sharing = _answers_smb([f["address"] for f in peers if f["address"]], timeout=3.0)
    peers = [f for f in peers if f["address"] in sharing or (f["address"] and f["maker"])]
    seen = {f["address"] for f in peers}
    for net, via in routes:
        hosts = _hosts_in(net)
        if not hosts:
            continue
        ips = sorted(_answers_smb(hosts) - seen, key=_ip_key)
        seen.update(ips)
        for ip, name in zip(ips, _reverse_names(ips)):
            peers.append({"name": name or ip, "host": ip, "address": ip, "maker": maker_of(name),
                          "away": True, "via": via})
    return {"installed": True, "running": True,
            "peers": sorted(peers, key=lambda f: ("via" in f, f["name"].lower()))}


def _ip_key(ip: str):
    return tuple(int(x) for x in ip.split("."))


def _hosts_in(net: str, most: int = 1024) -> list[str]:
    """Every address in a shared home network ("192.168.1.0/24"); none for a big one."""
    import ipaddress
    try:
        n = ipaddress.ip_network(net, strict=False)
    except ValueError:
        return []
    if n.version != 4 or n.num_addresses > most + 2:
        return []
    return [str(h) for h in (n.hosts() if n.prefixlen < 31 else n)]


def _answers_smb(ips: list[str], timeout: float = 0.8) -> set[str]:
    """The addresses that answer on the file-sharing port (445), checked together."""
    from concurrent.futures import ThreadPoolExecutor

    def knock(ip):
        try:
            with socket.create_connection((ip, 445), timeout=timeout):
                return ip
        except OSError:
            return None
    if not ips:
        return set()
    with ThreadPoolExecutor(max_workers=min(128, len(ips))) as pool:
        return {ip for ip in pool.map(knock, ips) if ip}


def _reverse_names(ips: list[str]) -> list[str]:
    """Each address's name on the network, or "" (looked up together: some take a while)."""
    from concurrent.futures import ThreadPoolExecutor

    def name(ip):
        try:
            return socket.gethostbyaddr(ip)[0].split(".")[0]
        except (OSError, UnicodeError):
            return ""
    if not ips:
        return []
    with ThreadPoolExecutor(max_workers=min(32, len(ips))) as pool:
        return list(pool.map(name, ips))


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
