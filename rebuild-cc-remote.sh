#!/bin/bash
set -e
echo === CC Remote - Rebuild ===
echo
PD="$(cd "$(dirname "$0")" && pwd)"
cd "$PD"
echo "[INFO] Pulling latest..."
git pull --rebase 2>/dev/null || echo "[WARN] Not a git repo or offline, skipping pull"
echo "[INFO] Installing deps..."
pnpm install
echo "[INFO] Building..."
pnpm build
echo
echo "[OK] Rebuild complete"
echo "Run: bash $PD/start-cc-remote.sh"
