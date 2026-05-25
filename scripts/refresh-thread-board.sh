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

# Mirror the registry to a local path so the board server (which runs as a
# launchd agent without access to Drive/network FUSE mounts) can serve the
# board without blocking on Drive I/O. The server reads from this local copy.
LOCAL_BOARD_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ai-threads-kanban"
mkdir -p "$LOCAL_BOARD_DIR" 2>/dev/null || true
REGISTRY_DIR="$("$NODE" -e "
const p='$HOME/.config/ai-threads-kanban/registry-root';
const f=require('fs');
const r=process.env.AI_AGENT_MEMORY_ROOT||process.env.AGENT_MEMORY_ROOT;
if(process.env.AGENT_THREADS_OUTPUT_DIR){process.stdout.write(process.env.AGENT_THREADS_OUTPUT_DIR);}
else if(r){process.stdout.write(r+'/projects/agent-threads');}
else if(f.existsSync(p)){process.stdout.write(f.readFileSync(p,'utf8').trim());}
" 2>/dev/null)"
if [ -n "$REGISTRY_DIR" ] && [ -f "$REGISTRY_DIR/active-threads.jsonl" ]; then
  cp "$REGISTRY_DIR/active-threads.jsonl" "$LOCAL_BOARD_DIR/active-threads.jsonl" 2>/dev/null || true
fi

# Mirror the telemetry events file as well so the board server's /telemetry page works
TELEMETRY_EVENTS_FILE="$("$NODE" -e "
const f=require('fs');
const path=require('path');
const os=require('os');
function resolveMemoryRoot() {
  const env = process.env.AI_AGENT_MEMORY_ROOT || process.env.AGENT_MEMORY_ROOT;
  if (env) return env;
  const configPath = path.join(os.homedir(), '.config', 'ai-skills', 'agent-memory-root');
  if (f.existsSync(configPath)) {
    const root = f.readFileSync(configPath, 'utf8').trim();
    if (root) return root;
  }
  return path.join(os.homedir(), '.agent-memory');
}
const eventsFile = path.join(resolveMemoryRoot(), 'skill-telemetry', 'events.jsonl');
if (f.existsSync(eventsFile)) {
  process.stdout.write(eventsFile);
}
" 2>/dev/null)"

if [ -n "$TELEMETRY_EVENTS_FILE" ] && [ -f "$TELEMETRY_EVENTS_FILE" ]; then
  mkdir -p "$LOCAL_BOARD_DIR/skill-telemetry" 2>/dev/null || true
  cp "$TELEMETRY_EVENTS_FILE" "$LOCAL_BOARD_DIR/skill-telemetry/events.jsonl" 2>/dev/null || true
fi

exit 0

