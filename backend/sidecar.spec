# PyInstaller build of the LazyCreatives Backups FastAPI sidecar (onedir).
#
#   cd backend
#   .venv/bin/pip install pyinstaller
#   .venv/bin/pyinstaller sidecar.spec --noconfirm --distpath dist
#
# -> backend/dist/ablebackup-sidecar/ablebackup-sidecar  (electron-builder copies
#    this folder into the app's Resources/sidecar; main.js runs it when packaged).
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas, binaries, hiddenimports = [], [], []
for pkg in ("uvicorn", "fastapi", "starlette", "apscheduler", "defusedxml",
            "websockets", "pydantic"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# Bundle our own package as BYTECODE only (collect_submodules), NOT via collect_all
# — collect_all would also ship every .py as readable source in _internal/, exposing
# the licensing logic + keys. The bytecode goes into the PYZ; no plaintext source.
hiddenimports += collect_submodules("ablebackup")

a = Analysis(
    ["ablebackup/server.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="ablebackup-sidecar",
    console=True,          # the sidecar logs to stdout/stderr (captured by main.js)
)
coll = COLLECT(exe, a.binaries, a.datas, name="ablebackup-sidecar")
