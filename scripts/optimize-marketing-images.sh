#!/usr/bin/env bash
# Generate AVIF + WebP siblings for every raster image in public/marketing.
#
# The landing page serves images through <picture> with AVIF -> WebP -> original
# fallback. <picture> picks a <source> by FORMAT SUPPORT, not by whether the file
# exists — so a browser that supports AVIF but finds a missing .avif shows a
# broken image. This script keeps every .png/.jpg paired with .avif + .webp so
# that never happens. Re-run it whenever a marketing image is added or changed.
#
# Non-destructive: it never resizes or overwrites the source .png/.jpg (those are
# the fallbacks and the canonical size). One-time downsizing of oversized sources
# was done by hand; this only (re)encodes the modern-format derivatives.
#
# Requires: cwebp (libwebp), avifenc (libavif). On macOS: `brew install webp libavif`.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/public/marketing"

for tool in cwebp avifenc; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: '$tool' not found (brew install webp libavif)"; exit 1; }
done

shopt -s nullglob nocaseglob
for src in "$DIR"/*.png "$DIR"/*.jpg "$DIR"/*.jpeg; do
  base="${src%.*}"
  echo "optimizing $(basename "$src")"
  cwebp -quiet -q 82 "$src" -o "$base.webp"
  avifenc -q 60 -s 6 "$src" "$base.avif" >/dev/null
done
echo "done."
