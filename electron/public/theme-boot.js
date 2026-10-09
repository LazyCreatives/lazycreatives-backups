// Light or dark before the first paint, so a light-mode window never flashes dark.
// SHARED FILE: the same file lives in Backups and Uploader (electron/public/theme-boot.js).
// Mirrors applyTheme in src/look.ts, which takes over once the app has loaded.
(function () {
  var choice = "dark";
  try { choice = localStorage.getItem("lc-theme") || "dark"; } catch (e) { /* storage off: dark */ }
  var systemDark = !(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
  var dark = choice === "system" ? systemDark : choice !== "light";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  // Easier reading (src/reading.ts, applyReading), so the first paint already has it.
  try {
    var r = JSON.parse(localStorage.getItem("lc-reading") || "{}");
    if (r && r.on === true) {
      var h = document.documentElement;
      h.setAttribute("data-reading", "on");
      h.setAttribute("data-read-font", r.font || "atkinson");
      h.setAttribute("data-read-space", r.space || "wider");
      h.setAttribute("data-read-tint", r.tint || "none");
      if (r.calm !== false) h.setAttribute("data-read-calm", "on");
    }
  } catch (e) { /* storage off or unreadable: reading view off */ }
})();
