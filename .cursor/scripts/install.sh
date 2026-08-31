#!/usr/bin/env bash
set -euo pipefail

cd /workspace

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi

export PATH="$HOME/.bun/bin:$PATH"

corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
