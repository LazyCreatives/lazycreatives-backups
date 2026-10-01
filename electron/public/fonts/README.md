# Display font drop-zone — "Slothy Jelly"

The app's `@font-face` (in `src/theme.css`) and the `--display` / `.display` styles
expect the wordmark typeface here:

- `slothy-jelly.woff2`  (preferred)
- `slothy-jelly.ttf`    (fallback)

Until a file is present, anything using `--display` falls back to **Inter** — no
error, the wordmark just isn't hand-lettered yet.

⚠️ **Licence:** Slothy Jelly (by Scratch Design) is **free for personal use only**.
Buy a commercial/web licence (MyFonts / Font Bundles / Creative Market) before
shipping it in the product. Do **not** commit the font until the licence allows it.
