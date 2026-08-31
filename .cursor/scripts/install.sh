#!/usr/bin/env bash
set -euo pipefail

cd /workspace

corepack enable
corepack prepare pnpm@11.24.0 --activate
pnpm install --frozen-lockfile
