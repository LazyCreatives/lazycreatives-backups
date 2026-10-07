"""Boot the frozen sidecar and fail unless /health answers 200 within 60s."""
import json, os, subprocess, sys, tempfile, time, urllib.request

exe = sys.argv[1]
port = "8770"
env = {**os.environ, "ABLEBACKUP_TOKEN": "ci", "ABLEBACKUP_PORT": port,
       "ABLEBACKUP_DB": os.path.join(tempfile.mkdtemp(), "ci.db")}
proc = subprocess.Popen([exe], env=env)
try:
    for _ in range(60):
        time.sleep(1)
        if proc.poll() is not None:
            sys.exit(f"sidecar exited early with code {proc.returncode}")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as r:
                if r.status == 200:
                    # the bundled ffmpeg must run, or AIFF / Apple Lossless won't play
                    if not json.load(r).get("player"):
                        sys.exit("sidecar's audio decoder (ffmpeg) is missing or won't run")
                    print("sidecar /health OK")
                    sys.exit(0)
        except OSError:
            pass
    sys.exit("sidecar never answered /health")
finally:
    if proc.poll() is None:
        proc.kill()
