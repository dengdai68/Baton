#!/bin/sh
# Renders each relay/docs/*.svg to a 2x PNG with headless Chrome (macOS path by default).
set -eu
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
cd "$(dirname "$0")"
for svg in fig*.svg; do
  size=$(sed -n 's/^<svg [^>]*width="\([0-9]*\)" height="\([0-9]*\)".*/\1,\2/p' "$svg")
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --default-background-color=ffffffff --window-size="$size" \
    --screenshot="$PWD/${svg%.svg}.png" "file://$PWD/$svg" >/dev/null 2>&1
  echo "${svg%.svg}.png $size"
done
