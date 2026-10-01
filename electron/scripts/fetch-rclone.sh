#!/usr/bin/env bash
# Download the official rclone binary for one platform into electron/rclone/, so
# electron-builder ships it in the app (Resources/rclone). Cloud copies (Google
# Drive, Dropbox, OneDrive, S3…) run through rclone; without it those buttons are
# dead for anyone who hasn't installed rclone themselves.
#
#   scripts/fetch-rclone.sh osx-arm64 | windows-amd64 | linux-amd64
#
# rclone is MIT licensed; its licence text ships next to the binary.
set -euo pipefail

RCLONE_VERSION="v1.70.3"
plat="${1:?usage: fetch-rclone.sh <osx-arm64|windows-amd64|linux-amd64>}"
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/rclone"
name="rclone-${RCLONE_VERSION}-${plat}"
base="https://github.com/rclone/rclone/releases/download/${RCLONE_VERSION}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/$name.zip" "$base/$name.zip"
curl -fsSL --retry 3 -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"

want="$(grep " $name.zip\$" "$tmp/SHA256SUMS" | awk '{print $1}')"
if command -v sha256sum >/dev/null; then got="$(sha256sum "$tmp/$name.zip" | awk '{print $1}')"
else got="$(shasum -a 256 "$tmp/$name.zip" | awk '{print $1}')"; fi
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "rclone checksum mismatch ($got vs $want)"; exit 1; }

unzip -q "$tmp/$name.zip" -d "$tmp"
rm -rf "$out" && mkdir -p "$out"
exe="rclone"; [[ "$plat" == windows-* ]] && exe="rclone.exe"
cp "$tmp/$name/$exe" "$out/$exe"
chmod +x "$out/$exe"
curl -fsSL --retry 3 -o "$out/LICENSE.txt" \
  "https://raw.githubusercontent.com/rclone/rclone/${RCLONE_VERSION}/COPYING"
echo "rclone ${RCLONE_VERSION} (${plat}) -> $out/$exe"
