# PyInstaller build of the LazyCreatives Backups FastAPI sidecar (onedir).
#
#   cd backend
#   .venv/bin/pip install pyinstaller
#   .venv/bin/pyinstaller sidecar.spec --noconfirm --distpath dist
#
# -> backend/dist/ablebackup-sidecar/ablebackup-sidecar  (electron-builder copies
#    this folder into the app's Resources/sidecar; main.js runs it when packaged).
from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ("uvicorn", "fastapi", "starlette", "apscheduler", "defusedxml",
            "websockets", "pydantic", "ablebackup"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

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
