// Light or dark before the first paint, so a light-mode window never flashes dark.
// SHARED FILE: the same file lives in Backups and Uploader (electron/public/theme-boot.js).
// Mirrors applyTheme in src/look.ts, which takes over once the app has loaded.
(function () {
  var choice = "dark";
  try { choice = localStorage.getItem("lc-theme") || "dark"; } catch (e) { /* storage off: dark */ }
  var systemDark = !(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
  var dark = choice === "system" ? systemDark : choice !== "light";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
