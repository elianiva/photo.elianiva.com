#!/usr/bin/env bash
set -euo pipefail

# Default to the Cloud Agent / plain dev URL. Override: BASE=http://localhost:5173 ./doctor.sh
BASE="${1:-${BASE:-http://localhost:5173}}"
FAIL=0

say() { printf '%s\n' "$*"; }
ok() { say "ok: $*"; }
fail() { say "fail: $*"; FAIL=1; }

say "doctor: base=$BASE"

if curl -sSf "$BASE/" 2>/dev/null | grep -q 'data-foldkit-app\|id="root"'; then
  ok "GET / returns Foldkit app shell"
else
  fail "GET / missing Foldkit app shell (is pnpm dev running? try: pnpm dev)"
fi

if [ "$FAIL" -eq 0 ]; then
  say "doctor: pass"
else
  say "doctor: fail"
fi
exit "$FAIL"
