#!/bin/bash
set -e
echo === CC Remote - Environment Setup ===
echo
echo [CHECK] Node.js...
command -v node || { echo "[FAIL] Node.js not found"; exit 1; }
echo [CHECK] pnpm...
command -v pnpm || npm install -g pnpm

PD="$(cd "$(dirname "$0")" && pwd)"

echo
echo "[INFO] Installing deps & building..."
cd "$PD" && pnpm install && pnpm build
echo
echo "=== Setup Complete ==="
echo "Run: bash $PD/start-cc-remote.sh"
