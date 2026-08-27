#!/usr/bin/env bash
set -euo pipefail

# Default to portless URL; fallback to https://photo.localhost if portless not available.
# Override with explicit arg or BASE env: BASE=https://photo.localhost ./doctor.sh
PORTLESS_URL="$(portless get photo 2>/dev/null || echo https://photo.localhost)"
BASE="${1:-${BASE:-$PORTLESS_URL}}"
FAIL=0

say() { printf '%s\n' "$*"; }
ok() { say "ok: $*"; }
fail() { say "fail: $*"; FAIL=1; }

say "doctor: base=$BASE"

# -k tolerates local CA until trusted; portless CA is trusted on this machine but -k keeps CI simple
# Foldkit shell renders data-foldkit-app; older fallback had id="root"
if curl -k -sSf "$BASE/" 2>/dev/null | grep -q 'data-foldkit-app\|id="root"'; then
  ok "GET / returns Foldkit app shell"
else
  fail "GET / missing Foldkit app shell (is pnpm dev running? try: pnpm dev && portless get photo)"
fi

if [ "$FAIL" -eq 0 ]; then
  say "doctor: pass"
else
  say "doctor: fail"
fi
exit "$FAIL"
