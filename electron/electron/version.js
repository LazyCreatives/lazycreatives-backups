// "0.1.10" > "0.1.9"; ignores a leading "v" and any "-beta" style suffix.
// Kept free of electron imports so the renderer tests can load it.
function isNewer(latest, current) {
  const parts = (v) => String(v).replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

module.exports = { isNewer };
