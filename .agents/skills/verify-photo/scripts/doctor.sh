#!/usr/bin/env bash
set -euo pipefail

# Default to the dev site; override with an explicit arg or BASE env:
#   BASE=http://localhost:5173 .pi/skills/verify-photo/scripts/doctor.sh
BASE="${1:-${BASE:-http://localhost:5173}}"
API_BASE="${API_BASE:-http://localhost:13371}"
FAIL=0

say() { printf '%s\n' "$*"; }
ok() { say "ok: $*"; }
fail() { say "fail: $*"; FAIL=1; }

say "doctor: base=$BASE api=$API_BASE"

# Foldkit shell renders data-foldkit-app; older fallback had id="root"
if curl -sSf "$BASE/" 2>/dev/null | grep -q 'data-foldkit-app\|id="root"'; then
  ok "GET / returns Foldkit app shell"
else
  fail "GET / missing Foldkit app shell (is pnpm dev running? try: pnpm dev)"
fi

# The API Worker is a second origin, not a path proxied by the site.
if curl -sSf "$API_BASE/api/health" >/dev/null 2>&1; then
  ok "GET /api/health on the API Worker"
else
  fail "GET /api/health missing on the API Worker (dev.port 13371)"
fi

if [ "$FAIL" -eq 0 ]; then
  say "doctor: pass"
else
  say "doctor: fail"
fi
exit "$FAIL"
