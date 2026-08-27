#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://127.0.0.1:13370}"
FAIL=0

say() { printf '%s\n' "$*"; }
ok() { say "ok: $*"; }
fail() { say "fail: $*"; FAIL=1; }

say "doctor: base=$BASE"

if curl -sSf "$BASE/" 2>/dev/null | grep -q 'id="root"'; then
  ok "GET / returns Foldkit root"
else
  fail "GET / missing Foldkit root (is pnpm dev running on 13370?)"
fi

RPC_BODY='{"_tag":"ListPhotos","limit":1}'
if curl -sSf -X POST "$BASE/api/rpc" -H 'content-type: application/json' -d "$RPC_BODY" 2>/dev/null | grep -q '"items"'; then
  ok "POST /api/rpc ListPhotos returns items"
else
  fail "POST /api/rpc ListPhotos did not return items"
fi

RPC_TAGS='{"_tag":"ListTags"}'
if curl -sSf -X POST "$BASE/api/rpc" -H 'content-type: application/json' -d "$RPC_TAGS" 2>/dev/null | grep -q '"label"\|"slug"\|\[\]'; then
  ok "POST /api/rpc ListTags reachable"
else
  fail "POST /api/rpc ListTags unreachable"
fi

if [ "$FAIL" -eq 0 ]; then
  say "doctor: pass"
else
  say "doctor: fail"
fi
exit "$FAIL"
