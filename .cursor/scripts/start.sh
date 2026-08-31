#!/usr/bin/env bash
set -euo pipefail

cd /workspace

PORTLESS_BIN="${PORTLESS_BIN:-./node_modules/.bin/portless}"

if [ ! -x "$PORTLESS_BIN" ]; then
  echo "portless binary not found at $PORTLESS_BIN; run install first" >&2
  exit 1
fi

if ! "$PORTLESS_BIN" doctor 2>&1 | grep -q "Local CA is trusted"; then
  "$PORTLESS_BIN" trust
fi

if ! "$PORTLESS_BIN" doctor 2>&1 | grep -q "Proxy is responding"; then
  sudo env PATH="$PATH" "$PORTLESS_BIN" proxy start
fi

for _ in $(seq 1 30); do
  if "$PORTLESS_BIN" doctor 2>&1 | grep -q "Proxy is responding"; then
    exit 0
  fi
  sleep 1
done

echo "portless proxy failed to become ready" >&2
exit 1
