#!/usr/bin/env bash
# Register the AI Thread Board web server as a macOS LaunchAgent so it
# starts at login and is kept alive. Mirrors the Windows "AI Thread Board"
# scheduled task. Idempotent — re-running unloads and reloads cleanly.
#
# Usage:
#   scripts/install-thread-board-launchagent.sh           # install + load
#   scripts/install-thread-board-launchagent.sh --port 9000
#   scripts/install-thread-board-launchagent.sh --registry-root PATH
#   scripts/install-thread-board-launchagent.sh --uninstall

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.yeretagility.ai-thread-board"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=7878
UNINSTALL=0
REGISTRY_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --registry-root) REGISTRY_ROOT="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)
      sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ "$UNINSTALL" -eq 1 ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL."
  exit 0
fi

NODE="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE" ]]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [[ -x "$c" ]] && NODE="$c" && break
  done
fi
if [[ -z "$NODE" ]]; then
  echo "node not found — install Node.js first (brew install node)." >&2
  exit 1
fi

SCRIPT="$REPO_ROOT/scripts/serve-thread-board.mjs"
[[ -f "$SCRIPT" ]] || { echo "Missing $SCRIPT" >&2; exit 1; }

if [[ -z "$REGISTRY_ROOT" ]]; then
  if [[ -f "$HOME/.config/ai-threads-kanban/registry-root" ]]; then
    REGISTRY_ROOT="$(cat "$HOME/.config/ai-threads-kanban/registry-root" | tr -d '\r\n' | xargs)"
  else
    REGISTRY_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/ai-threads-kanban"
  fi
fi

# The board server runs as a launchd agent which can block on Google Drive /
# network FUSE reads. Keep the server on a local mirror, seeded here and kept
# current by refresh-thread-board.sh and goal review runs.
LOCAL_BOARD_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ai-threads-kanban"
mkdir -p "$REGISTRY_ROOT" "$LOCAL_BOARD_DIR" "$HOME/Library/LaunchAgents"
for f in active-threads.jsonl goal-network.json goal-network.md goal-overrides.json goal-review-state.json goal-review-history.jsonl goal-review.md machines.json; do
  if [[ -f "$REGISTRY_ROOT/$f" ]]; then
    cp "$REGISTRY_ROOT/$f" "$LOCAL_BOARD_DIR/$f" 2>/dev/null || true
  fi
done

ENV_BLOCK="    <key>EnvironmentVariables</key>
    <dict>
        <key>AGENT_THREADS_OUTPUT_DIR</key>
        <string>$LOCAL_BOARD_DIR</string>
    </dict>"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE</string>
        <string>$SCRIPT</string>
        <string>--port</string>
        <string>$PORT</string>
    </array>
$ENV_BLOCK
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/ai-thread-board.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/ai-thread-board-err.log</string>
    <key>WorkingDirectory</key>
    <string>$REPO_ROOT</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "Installed $LABEL — board running at http://127.0.0.1:$PORT"
echo "Logs: /tmp/ai-thread-board.log  (err: /tmp/ai-thread-board-err.log)"
