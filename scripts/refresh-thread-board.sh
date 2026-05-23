#!/usr/bin/env bash
# Refresh the AI thread registry: scan native harness history, reconcile,
# stamp Codex session names. POSIX counterpart of refresh-thread-board.ps1,
# for macOS/Linux harness Stop hooks. Never fails a session — always exits 0.

DIR="$(cd "$(dirname "$0")" && pwd)"

NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$c" ]; then NODE="$c"; break; fi
  done
fi
[ -z "$NODE" ] && exit 0

"$NODE" "$DIR/scan-session-history.mjs" --days 30 >/dev/null 2>&1
"$NODE" "$DIR/reconcile-threads.mjs" >/dev/null 2>&1
"$NODE" "$DIR/apply-thread-names.mjs" >/dev/null 2>&1

exit 0
