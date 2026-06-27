#!/bin/bash
set -e
echo === CC Remote - Rebuild ===
echo
PD="$HOME/.claude/tools/cc-remote"
if [ ! -d "$PD" ]; then echo "[FAIL] Project not found: $PD"; exit 1; fi
cd "$PD"
echo "[INFO] Pulling latest..."
git pull --rebase 2>/dev/null || echo "[WARN] Not a git repo or offline, skipping pull"
echo "[INFO] Installing deps..."
pnpm install
echo "[INFO] Building..."
pnpm build
echo
echo "[OK] Rebuild complete"
