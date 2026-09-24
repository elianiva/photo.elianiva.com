#!/usr/bin/env bash
set -euo pipefail

cd /workspace

BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"

if [[ ! -x "$BUN_INSTALL/bin/bun" ]]; then
  curl -fsSL https://bun.sh/install | bash
fi

export PATH="$BUN_INSTALL/bin:$PATH"

# Cloud Agent terminals may not source .bashrc; keep PATH durable for interactive shells too.
grep -q 'BUN_INSTALL="$HOME/.bun"' "$HOME/.bashrc" 2>/dev/null || {
  cat >>"$HOME/.bashrc" <<'EOF'

# bun (alchemy dev)
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF
}

corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile

bun --version
