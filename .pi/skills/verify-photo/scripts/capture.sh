#!/usr/bin/env bash
set -euo pipefail

ID="${1:-gallery-browse}"
BASE="${BASE:-http://127.0.0.1:13370}"
OUT=".pi/skills/verify-photo/artifacts/$ID"

mkdir -p "$OUT"
echo "capture: $ID -> $OUT"

if command -v npx >/dev/null 2>&1 && npx agent-browser --help >/dev/null 2>&1; then
  npx agent-browser snapshot --aria --path "$OUT/page.aria.txt" || echo "snapshot failed (is browser open?)"
  npx agent-browser screenshot --path "$OUT/page.png" || echo "screenshot failed"
else
  echo "agent-browser not available, dumping HTTP mark"
  curl -sSf "$BASE/" | head -n 50 > "$OUT/page.html"
fi

echo "artifacts in $OUT"
ls -la "$OUT" || true
