// What goes in a problem report: the GitHub "new issue" link with the app version,
// the computer and (after a crash) what went wrong already filled in. Pure functions,
// no electron import, so the tests can check exactly what a report would contain.
// Same file in both apps.

const MAX_DETAIL = 1800; // keeps the whole link well under GitHub's length limit

// Never let a report carry who you are or where your files live: your home folder
// becomes "~", and email addresses and anything that looks like a key are blanked.
function scrub(text, home) {
  let t = String(text == null ? "" : text);
  if (home) {
    const variants = new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")]);
    for (const v of variants) if (v.length > 1) t = t.split(v).join("~");
  }
  t = t.replace(/\b(?:Users|home)[\\/][^\\/\s"'`]+/g, (m) => m.split(/[\\/]/)[0] + "/~");
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email hidden]");
  t = t.replace(/\b(token|secret|password|passwd|authorization|bearer|api[_-]?key)(["']?\s*[:=]\s*["']?|\s+)[^\s"',&]+/gi,
    (_m, k, sep) => `${k}${sep}[hidden]`);
  t = t.replace(/([?&](?:token|code|access_token|refresh_token|client_secret)=)[^&\s]+/gi, "$1[hidden]");
  if (t.length > MAX_DETAIL) t = t.slice(0, MAX_DETAIL) + "\n…(cut short)";
  return t;
}

// "macOS 15.1 (Apple Silicon)", "Windows 10.0.22631 (64-bit)", "Linux 6.8.0 (64-bit)".
function computerLabel(platform, version, arch) {
  const name = platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : platform;
  const chip = platform === "darwin"
    ? (arch === "arm64" ? "Apple Silicon" : "Intel")
    : (arch === "x64" || arch === "arm64" ? `64-bit${arch === "arm64" ? " ARM" : ""}` : arch);
  return `${name} ${version || ""}`.trim() + (chip ? ` (${chip})` : "");
}

// What each kind of crash is called in the message and the report.
const CRASH_WORDS = {
  error: "ran into an error",
  window: "window stopped working",
  engine: "engine stopped unexpectedly",
  start: "couldn't start",
  sudden: "closed suddenly",
};
const OWN = new Set(["window", "engine"]); // "Uploader's window", "Backups' engine"

function crashWords(crash) {
  return CRASH_WORDS[crash && crash.kind] || "ran into a problem";
}

function crashHeadline(appName, crash) {
  if (!OWN.has(crash && crash.kind)) return `${appName} ${crashWords(crash)}`;
  return `${appName}${/s$/.test(appName) ? "'" : "'s"} ${crashWords(crash)}`;
}

// The first useful line of the saved detail, for the report's title.
function firstLine(detail) {
  const line = String(detail || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  return line.length > 90 ? line.slice(0, 87) + "…" : line;
}

// The GitHub link that opens the report form, filled in. Nothing is sent: the person
// reads it on GitHub, changes anything they like and presses Submit themselves.
function reportUrl({ repo, appName, version, computer, crash }) {
  const lines = [
    "**What happened?**",
    crash ? "(What were you doing when it happened? Anything you can add helps.)" : "(Tell us what you were doing and what went wrong.)",
    "",
    "**Can you make it happen again? How?**",
    "1. ",
    "",
    "---",
    `App: ${appName} ${version}`,
    `Computer: ${computer}`,
  ];
  if (crash) {
    lines.push(`Problem: ${OWN.has(crash.kind) ? "the " : ""}${crashWords(crash)}${crash.at ? `, ${crash.at.slice(0, 16).replace("T", " ")} UTC` : ""}`);
    if (crash.detail) {
      lines.push("", "What the app saved when it happened (your home folder is shown as ~):", "```", crash.detail, "```");
    }
  }
  const title = crash ? `Crash: ${firstLine(crash.detail) || crashHeadline(appName, crash)}` : "";
  const q = new URLSearchParams();
  if (title) q.set("title", title);
  q.set("body", lines.join("\n"));
  return `https://github.com/LazyCreatives/${repo}/issues/new?${q.toString()}`;
}

module.exports = { scrub, computerLabel, crashHeadline, reportUrl, MAX_DETAIL };
