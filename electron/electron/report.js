// "Report a problem" and the crash catcher. Same file in both apps.
//
// When something breaks (an error in the app, the window or the engine stopping, the
// app closing suddenly), a short note of what went wrong is kept on this computer.
// The app then asks once: "Report it?" opens GitHub's report form already filled in.
// Nothing is ever sent by the app itself: the person reads the form on GitHub and
// presses Submit or closes it. No music, project files, file lists or logins are
// included, and the home folder is hidden (reportText.js).

const { app, crashReporter, dialog, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { scrub, computerLabel, crashHeadline, reportUrl } = require("./reportText");

let opts = { appName: "LazyCreatives", repo: "" };
let asking = false;

const noteFile = () => path.join(app.getPath("userData"), "last-problem.json");
const seenFile = () => path.join(app.getPath("userData"), "crash-files-seen.json");

// Call before the app is ready. Sudden closes leave a crash file on this computer only
// (never uploaded); next launch notices a new one and offers to report it.
function startCrashCatcher(o) {
  opts = { ...opts, ...o };
  try { crashReporter.start({ uploadToServer: false, compress: false }); } catch { /* not fatal */ }
}

const computer = () => computerLabel(process.platform, safe(() => process.getSystemVersion(), os.release()), process.arch);
const safe = (fn, fallback) => { try { return fn() || fallback; } catch { return fallback; } };

function linkFor(crash) {
  return reportUrl({ repo: opts.repo, appName: opts.appName, version: app.getVersion(), computer: computer(), crash });
}

// Help > Report a problem, and the Settings button.
function reportProblem() {
  shell.openExternal(linkFor(null));
}

// Keep a note of what went wrong. Never throws: this runs while things are failing.
function recordProblem(kind, detail) {
  try {
    const note = { kind, detail: scrub(detail, os.homedir()), version: app.getVersion(), at: new Date().toISOString() };
    fs.writeFileSync(noteFile(), JSON.stringify(note));
    markCrashFilesSeen(60_000); // the crash file this same problem may leave is not a second one
  } catch { /* nowhere to keep it; the dialog still shows below */ }
}

function takeNote() {
  try {
    const note = JSON.parse(fs.readFileSync(noteFile(), "utf8"));
    fs.rmSync(noteFile(), { force: true });
    return note && note.kind ? note : null;
  } catch { return null; }
}

// Crash files newer than the last ones we asked about mean the app closed suddenly.
function crashFiles() {
  let dir;
  try { dir = app.getPath("crashDumps"); } catch { return []; }
  const out = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && /\.dmp$/i.test(e.name)) {
        try { out.push(fs.statSync(p).mtimeMs); } catch { /* gone */ }
      }
    }
  };
  walk(dir, 0);
  return out;
}

function lastSeen() {
  try { return JSON.parse(fs.readFileSync(seenFile(), "utf8")).seen || 0; } catch { return null; }
}

function markCrashFilesSeen(extraMs = 0) {
  try {
    const newest = Math.max(Date.now() + extraMs, ...crashFiles());
    fs.writeFileSync(seenFile(), JSON.stringify({ seen: newest }));
  } catch { /* ignore */ }
}

function suddenClose() {
  const seen = lastSeen();
  const newer = crashFiles().filter((t) => seen !== null && t > seen);
  markCrashFilesSeen(); // first run only sets the starting point; never ask about old files
  return newer.length ? { kind: "sudden", detail: "", version: app.getVersion(), at: new Date(Math.max(...newer)).toISOString() } : null;
}

// Ask once about the newest problem, if there is one. "Not now" forgets it.
async function offerReport(win) {
  if (asking) return;
  const crash = takeNote() || suddenClose();
  if (!crash) return;
  asking = true;
  try {
    const shown = crash.detail ? crash.detail.split("\n").slice(0, 6).join("\n") : "";
    const box = {
      type: "warning",
      buttons: ["Report it", "Not now"], defaultId: 0, cancelId: 1, noLink: true,
      message: `${crashHeadline(opts.appName, crash)}${crash.kind === "sudden" ? " last time" : ""}`,
      detail:
        "Report it opens a short report on GitHub with the app version and your computer type filled in. " +
        "You can read and change all of it before you press Submit. Nothing is sent by itself, " +
        "and no music, project files or logins are included." +
        (shown ? `\n\nWhat went wrong:\n${shown}` : ""),
    };
    const usable = win && !win.isDestroyed() && win.isVisible();
    const { response } = usable ? await dialog.showMessageBox(win, box) : await dialog.showMessageBox(box);
    if (response === 0) shell.openExternal(linkFor(crash));
  } catch { /* ignore */ } finally { asking = false; }
}

// When the app can't start at all: say so, and offer the report there and then.
function startFailed(err) {
  const detail = String((err && (err.stack || err.message)) || err);
  recordProblem("start", detail);
  try {
    const r = dialog.showMessageBoxSync({
      type: "error", buttons: ["Report it", "Close"], defaultId: 0, cancelId: 1, noLink: true,
      message: `${opts.appName} couldn't start`,
      detail: "The part of the app that does the work failed to start. Reinstalling usually fixes it.\n\n" +
        "Report it opens a short report on GitHub that you can read before sending. Nothing is sent by itself.\n\n" +
        scrub(detail, os.homedir()).split("\n").slice(0, 6).join("\n"),
    });
    const crash = takeNote();
    if (r === 0) shell.openExternal(linkFor(crash));
  } catch { /* ignore */ }
}

module.exports = { startCrashCatcher, reportProblem, recordProblem, offerReport, startFailed };
