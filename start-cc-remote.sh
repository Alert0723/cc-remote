#!/bin/bash
# CC Remote 一键启动脚本（macOS / Linux）

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDIR="$SCRIPT_DIR/packages/server"

echo '=============================='
echo '  CC Remote'
echo '=============================='
echo ''

# 检查 Node.js
if ! command -v node &>/dev/null; then
    echo '[FAIL] Node.js not found in PATH'
    exit 1
fi

# 检查构建产物
if [ ! -f "$SDIR/dist/startup.js" ]; then
    echo "[FAIL] startup.js not found: $SDIR/dist/startup.js"
    echo 'Run "pnpm build" first.'
    exit 1
fi

cd "$SDIR"

echo 'Starting CC Remote...'
echo ''

node dist/startup.js --new-window "$@" 2>&1
ERR=$?

echo ''
echo '=============================='
if [ $ERR -ne 0 ]; then
    echo "[FAIL] Exit code: $ERR"
    cat "$HOME/.cc-remote/server.log" 2>/dev/null
else
    echo 'Server stopped.'
fi
echo '=============================='

exit $ERR
