#!/usr/bin/env bash
set -euo pipefail

ID="${1:-gallery-browse}"
BASE="${BASE:-http://localhost:5173}"
OUT=".cursor/skills/verify-photo/artifacts/$ID"

mkdir -p "$OUT"
echo "capture: $ID -> $OUT (BASE=$BASE)"

if command -v npx >/dev/null 2>&1 && npx agent-browser --help >/dev/null 2>&1; then
  npx agent-browser snapshot > "$OUT/page.aria.txt" || echo "snapshot failed (is browser open?)"
  npx agent-browser screenshot "$OUT/page.png" || echo "screenshot failed"
else
  echo "agent-browser not available, dumping HTTP mark"
  curl -sSf "$BASE/" | head -n 50 > "$OUT/page.html"
fi

echo "artifacts in $OUT"
ls -la "$OUT" || true
