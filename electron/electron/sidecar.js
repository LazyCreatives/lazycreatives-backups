const { spawn } = require("child_process");
const crypto = require("crypto");
const net = require("net");
const http = require("http");

const IS_WIN = process.platform === "win32";

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForHealth(port, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/health", timeout: 1000 },
        (res) => { res.resume(); resolve(); }
      );
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("sidecar health timeout"));
        else setTimeout(tick, 250);
      });
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

// Signal the sidecar's whole process group (POSIX) or process tree (Windows) so no
// uvicorn worker/thread is left behind. Negative pid targets the group, which the
// child leads thanks to `detached`. Swallows ESRCH (the process is already gone).
function killGroup(proc, signal) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    if (IS_WIN) {
      spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"]);
    } else {
      process.kill(-proc.pid, signal);
    }
  } catch {
    try { proc.kill(signal); } catch { /* already dead */ }
  }
}

async function startSidecar({ backendDir, dbPath, pythonCmd = "python", command, args, parentPid = process.pid }) {
  const token = crypto.randomBytes(24).toString("hex");
  const port = await freePort();
  const env = {
    ...process.env,
    ABLEBACKUP_TOKEN: token,
    ABLEBACKUP_PORT: String(port),
    ABLEBACKUP_DB: dbPath,
    // The sidecar watches this pid and exits if we die without cleaning it up
    // (e.g. an Electron crash), so it can never become an orphan.
    ABLEBACKUP_PARENT_PID: String(parentPid),
  };
  // Dev: `python -m ablebackup.server`. Packaged: the PyInstaller binary (command).
  const cmd = command || pythonCmd;
  const cmdArgs = args || ["-m", "ablebackup.server"];
  const proc = spawn(cmd, cmdArgs, {
    cwd: backendDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // Lead a new process group (POSIX) so we can signal the whole subtree on quit.
    detached: !IS_WIN,
  });
  let stderrBuf = "";
  proc.stdout.on("data", (d) => console.log("[sidecar]", d.toString().trim()));
  proc.stderr.on("data", (d) => {
    const s = d.toString();
    stderrBuf = (stderrBuf + s).slice(-4000); // keep the last ~4KB for diagnostics
    console.error("[sidecar]", s.trim());
  });
  const sidecar = { proc, token, port, stopped: false };
  proc.on("exit", () => { sidecar.stopped = true; });

  // A spawn failure (missing/quarantined binary, wrong arch, EACCES) emits an
  // 'error' event — turn it into a rejection so the caller's try/catch can show a
  // dialog instead of the app dying silently with no window.
  const spawnError = new Promise((_, reject) => {
    proc.on("error", (e) => reject(new Error(`could not start the backend: ${e.message}`)));
  });
  try {
    await Promise.race([waitForHealth(port), spawnError]);
  } catch (e) {
    throw new Error(`${e.message}${stderrBuf ? `\n\n--- backend output ---\n${stderrBuf}` : ""}`);
  }
  return sidecar;
}

// Stop the sidecar: ask politely (SIGTERM to the group), then force-kill (SIGKILL) if
// it has not exited within graceMs. Resolves once the process is gone (or the backstop
// fires) so a quit handler can await it without ever hanging. `kill` is injectable for
// tests.
function stopSidecar(sidecar, { graceMs = 3000, kill = killGroup } = {}) {
  return new Promise((resolve) => {
    const proc = sidecar && sidecar.proc;
    if (!proc || sidecar.stopped || proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(forceTimer);
      clearTimeout(backstopTimer);
      resolve();
    };
    proc.once("exit", finish);
    kill(proc, "SIGTERM");
    const forceTimer = setTimeout(() => kill(proc, "SIGKILL"), graceMs);
    // Absolute backstop: never let a quit block forever even if 'exit' never fires.
    const backstopTimer = setTimeout(finish, graceMs + 2000);
  });
}

module.exports = { startSidecar, stopSidecar, killGroup, freePort, waitForHealth };
