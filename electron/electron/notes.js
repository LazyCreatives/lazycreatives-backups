// Reads a version's "What's new" notes, either from the app's own CHANGELOG.md
// (bundled with the app, so it works offline) or from a GitHub Release's text
// (which the release job builds from the same CHANGELOG section).
//
// Notes come back as groups in the changelog's order:
//   [{ kind: "New", items: [{ title: "Search in the Library.", detail: "Type part of…" }] }]
// A line that opens with a **bold sentence.** uses it as its title; the rest is
// detail. Any other line is all title.
// Lines under a bullet (indented "  - ...") join that bullet's detail.
//
// Kept free of electron imports so the renderer tests can load it.
// Same file in both apps.

const KINDS = ["New", "Better", "Fixed"];

const clean = (s) => s.replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "");

// Markdown escapes such as \\ or \* become the plain character.
const unescape = (s) => s.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1");

// The lines of one "## <version> (date)" section of a changelog.
function changelogSection(text, version) {
  const want = String(version).replace(/^v/, "");
  const out = [];
  let inside = false;
  for (const line of clean(text).split("\n")) {
    if (line.startsWith("## ")) {
      if (inside) break;
      inside = line.slice(3).split(" ")[0].replace(/^v/, "") === want;
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join("\n").trim();
}

// The "## What's new" part of a GitHub Release's text, up to the "---" rule.
function releaseSection(body) {
  const out = [];
  let inside = false;
  for (const line of clean(String(body || "")).split("\n")) {
    if (/^##\s+what'?s new/i.test(line.trim())) { inside = true; continue; }
    if (!inside) continue;
    if (/^(---+|##\s)/.test(line.trim())) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

// "### New / - **Title.** detail" markdown into groups of items.
function parseNotes(md) {
  const groups = [];
  let group = null;
  let item = null;
  for (const raw of clean(String(md || "")).split("\n")) {
    const line = raw.trimEnd();
    const head = /^###\s+(.+)$/.exec(line);
    if (head) {
      const name = head[1].trim();
      const kind = KINDS.find((k) => k.toLowerCase() === name.toLowerCase()) || name;
      group = { kind, items: [] };
      groups.push(group);
      item = null;
      continue;
    }
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const text = unescape(bullet[2].trim());
      if (bullet[1].length > 0 && item) {          // a sub-point of the last bullet
        item.detail = [item.detail, text].filter(Boolean).join(" ");
        continue;
      }
      if (!group) { group = { kind: "New", items: [] }; groups.push(group); }
      // "**Title.** detail": bold words that end a sentence are the title.
      const bold = /^\*\*(.+?[.!?])\*\*\s*(.*)$/.exec(text);
      item = bold ? { title: bold[1].trim(), detail: bold[2].trim() } : { title: text.replace(/\*\*/g, ""), detail: "" };
      group.items.push(item);
      continue;
    }
    if (line.trim() && item) item.detail = [item.detail, unescape(line.trim())].filter(Boolean).join(" ");
  }
  return groups.filter((g) => g.items.length > 0);
}

const plain = (s) => s.replace(/\*\*/g, "");

// The short plain-text list shown in the update message box: each item's title,
// grouped under New / Better / Fixed, at most `max` lines.
function notesText(groups, max = 8) {
  const lines = [];
  let shown = 0, total = 0;
  for (const g of groups || []) {
    total += g.items.length;
    if (shown >= max) continue;
    if (lines.length) lines.push("");
    lines.push(g.kind);
    for (const it of g.items) {
      if (shown >= max) break;
      let t = plain(it.title);
      if (t.length > 110) t = t.slice(0, 107).trimEnd() + "…";
      lines.push(`•  ${t}`);
      shown++;
    }
  }
  if (total > shown) lines.push("", `…and ${total - shown} more.`);
  return lines.join("\n");
}

module.exports = { changelogSection, releaseSection, parseNotes, notesText };
