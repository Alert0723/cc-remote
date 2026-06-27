#!/bin/bash
set -e
echo === CC Remote - Environment Setup ===
echo
echo [CHECK] Node.js...
command -v node || { echo "[FAIL] Node.js not found"; exit 1; }
echo [CHECK] pnpm...
command -v pnpm || npm install -g pnpm
echo [CHECK] Git...
command -v git || { echo "[FAIL] Git not found"; exit 1; }
TD="$HOME/.claude/tools"
PD="$TD/cc-remote"
if [ -d "$PD" ]; then
  echo "[INFO] Already exists: $PD"
else
  echo "[INFO] Cloning from Gitee..."
  mkdir -p "$TD"
  git clone https://gitee.com/alert0723/cong.claude.git "$TD/cong.claude" 2>/dev/null || git clone https://github.com/Alert0723/cong.claude.git "$TD/cong.claude"
  if [ -d "$TD/cong.claude/tools/cc-remote" ]; then
    cp -r "$TD/cong.claude/tools/cc-remote" "$PD"
  elif [ -d "$TD/cong.claude/.claude/tools/cc-remote" ]; then
    cp -r "$TD/cong.claude/.claude/tools/cc-remote" "$PD"
  else
    echo "[FAIL] cc-remote not found in cloned repo"
    rm -rf "$TD/cong.claude"
    exit 1
  fi
  rm -rf "$TD/cong.claude"
  echo "[OK] Cloned"
fi
echo
echo "[INFO] Installing deps & building..."
cd "$PD" && pnpm install && pnpm build
echo
echo "=== Setup Complete ==="
echo "Run: bash $PD/start-cc-remote.sh"
