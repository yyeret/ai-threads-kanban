#!/usr/bin/env bash
# Install the AI Thread Board on macOS / Linux.
#
#   1. Resolve a registry root and persist it.
#   2. Render slash-command templates with this repo's path and copy them
#      into each detected harness (Claude / Codex / Gemini).
#   3. Wire scripts/refresh-thread-board.sh into each harness's Stop hook
#      (Codex auto-wired; Claude/Gemini get a TODO if their settings file
#      already exists — they need a hand-merge).
#   4. Seed the registry with a first scan.
#   5. Optionally install the board server as a launchd LaunchAgent so it
#      starts on login (skipped with --no-server).
#
# Idempotent — re-running updates the slash commands to the current repo path.
#
# Usage:
#   scripts/install.sh                          # default install
#   scripts/install.sh --registry-root PATH     # override registry location
#   scripts/install.sh --no-server              # skip the LaunchAgent step
#   scripts/install.sh --port 9000              # override server port

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY_ROOT=""
INSTALL_SERVER=1
PORT=7878

while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry-root) REGISTRY_ROOT="$2"; shift 2 ;;
    --no-server) INSTALL_SERVER=0; shift ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# 1. Registry root. If the user already runs an agent-memory vault we honor
#    AI_AGENT_MEMORY_ROOT; otherwise default to ~/.local/share/ai-threads-kanban.
if [[ -z "$REGISTRY_ROOT" ]]; then
  if [[ -f "$HOME/.config/ai-threads-kanban/registry-root" ]]; then
    REGISTRY_ROOT="$(cat "$HOME/.config/ai-threads-kanban/registry-root" | tr -d '\r\n' | xargs)"
  elif [[ -n "${AI_AGENT_MEMORY_ROOT:-}" ]]; then
    REGISTRY_ROOT="$AI_AGENT_MEMORY_ROOT/projects/agent-threads"
  else
    REGISTRY_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/ai-threads-kanban"
  fi
fi
mkdir -p "$REGISTRY_ROOT" "$HOME/.config/ai-threads-kanban"
echo "$REGISTRY_ROOT" > "$HOME/.config/ai-threads-kanban/registry-root"
echo "Registry root: $REGISTRY_ROOT"

# 1b. OS Versioning and Deployment Tracking
NODE_BIN="$(command -v node 2>/dev/null || true)"
[[ -z "$NODE_BIN" ]] && for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [[ -x "$c" ]] && NODE_BIN="$c" && break
done

if [[ -n "$NODE_BIN" ]]; then
  VERSION="$("$NODE_BIN" -e "console.log(require('$REPO_ROOT/package.json').version)" 2>/dev/null || grep '"version"' "$REPO_ROOT/package.json" | head -n 1 | cut -d'"' -f4)"
else
  VERSION="$(grep '"version"' "$REPO_ROOT/package.json" | head -n 1 | cut -d'"' -f4)"
fi

echo "Yuval-OS Version: $VERSION"

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")"
cat <<EOF > "$HOME/.config/ai-threads-kanban/version.json"
{
  "version": "$VERSION",
  "installed_at": "$TIMESTAMP",
  "repo_path": "$REPO_ROOT"
}
EOF

ACTIVE_HARNESSES=()
CLAUDE_INSTALLED="false"
CODEX_INSTALLED="false"
GEMINI_INSTALLED="false"
ANTIGRAVITY_INSTALLED="false"

if [[ -d "$HOME/.claude" ]]; then
  CLAUDE_INSTALLED="true"
  ACTIVE_HARNESSES+=("Claude")
  cp "$HOME/.config/ai-threads-kanban/version.json" "$HOME/.claude/ai-threads-version.json"
  echo "  Claude Code detected, writing version config."
fi

if [[ -d "$HOME/.codex" ]]; then
  CODEX_INSTALLED="true"
  ACTIVE_HARNESSES+=("Codex")
  cp "$HOME/.config/ai-threads-kanban/version.json" "$HOME/.codex/ai-threads-version.json"
  echo "  Codex detected, writing version config."
fi

if [[ -d "$HOME/.gemini" ]]; then
  GEMINI_INSTALLED="true"
  ACTIVE_HARNESSES+=("Gemini")
  cp "$HOME/.config/ai-threads-kanban/version.json" "$HOME/.gemini/ai-threads-version.json"
  echo "  Gemini detected, writing version config."
fi

if [[ -d "$HOME/.gemini/antigravity" ]]; then
  ANTIGRAVITY_INSTALLED="true"
  ACTIVE_HARNESSES+=("Antigravity")
  echo "  Antigravity detected."
fi

HARNESSES_JSON="["
first=1
for h in "${ACTIVE_HARNESSES[@]:-}"; do
  if [[ $first -eq 1 ]]; then
    HARNESSES_JSON+="\"$h\""
    first=0
  else
    HARNESSES_JSON+=", \"$h\""
  fi
done
HARNESSES_JSON+="]"

HOST_NAME="$(hostname)"
cat <<EOF >> "$REGISTRY_ROOT/deployments.jsonl"
{"machine":"$HOST_NAME","version":"$VERSION","timestamp":"$TIMESTAMP","harnesses":$HARNESSES_JSON,"status":"installed"}
EOF

MACHINES_JSON_PATH="$REGISTRY_ROOT/machines.json"
if [[ -n "$NODE_BIN" ]]; then
  "$NODE_BIN" -e "
    const fs = require('fs');
    const p = '$MACHINES_JSON_PATH';
    let data = {};
    if (fs.existsSync(p)) {
      try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) {}
    }
    data['$HOST_NAME'] = {
      version: '$VERSION',
      last_deployed: '$TIMESTAMP',
      harnesses: {
        Claude: { installed: $CLAUDE_INSTALLED, version: '$VERSION' },
        Codex: { installed: $CODEX_INSTALLED, version: '$VERSION' },
        Gemini: { installed: $GEMINI_INSTALLED, version: '$VERSION' },
        Antigravity: { installed: $ANTIGRAVITY_INSTALLED, version: '$VERSION' }
      }
    };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  " 2>/dev/null || true
else
  cat <<EOF > "$MACHINES_JSON_PATH"
{
  "$HOST_NAME": {
    "version": "$VERSION",
    "last_deployed": "$TIMESTAMP",
    "harnesses": {
      "Claude": { "installed": $CLAUDE_INSTALLED, "version": "$VERSION" },
      "Codex": { "installed": $CODEX_INSTALLED, "version": "$VERSION" },
      "Gemini": { "installed": $GEMINI_INSTALLED, "version": "$VERSION" },
      "Antigravity": { "installed": $ANTIGRAVITY_INSTALLED, "version": "$VERSION" }
    }
  }
}
EOF
fi

echo "Logged installation to deployments.jsonl and machines.json"

# 2. Slash commands — render {{REPO_ROOT}} and copy into each harness.
render() {
  sed "s#{{REPO_ROOT}}#${REPO_ROOT}#g" "$1"
}

install_skill() {
  local skill="$1"
  local src_dir="$REPO_ROOT/skills/$skill/commands"
  if [[ -d "$HOME/.claude/commands" ]] && [[ -f "$src_dir/claude.md" ]]; then
    render "$src_dir/claude.md" > "$HOME/.claude/commands/$skill.md"
    echo "  claude: $skill"
  fi
  if [[ -d "$HOME/.codex/prompts" ]] && [[ -f "$src_dir/codex.md" ]]; then
    render "$src_dir/codex.md" > "$HOME/.codex/prompts/$skill.md"
    echo "  codex: $skill"
  fi
  if [[ -d "$HOME/.gemini/commands" ]] && [[ -f "$src_dir/gemini.toml" ]]; then
    render "$src_dir/gemini.toml" > "$HOME/.gemini/commands/$skill.toml"
    echo "  gemini: $skill"
  fi
}

echo "Installing slash commands:"
for skill in thread-state finish-thread track-thread; do install_skill "$skill"; done

# 3. Stop-hook wiring. Codex hooks.json is small enough to template; Claude
#    and Gemini settings.json are larger user-owned files — we print a TODO
#    rather than risk overwriting them.
REFRESH="$REPO_ROOT/scripts/refresh-thread-board.sh"
chmod +x "$REFRESH" 2>/dev/null || true

CODEX_HOOKS="$HOME/.codex/hooks.json"
if [[ -d "$HOME/.codex" ]]; then
  if [[ ! -f "$CODEX_HOOKS" ]]; then
    printf '{ "Stop": [ { "command": "%s" } ] }\n' "$REFRESH" > "$CODEX_HOOKS"
    echo "Wrote $CODEX_HOOKS"
  elif ! grep -q "refresh-thread-board.sh" "$CODEX_HOOKS"; then
    echo "TODO: add a Stop hook in $CODEX_HOOKS that runs: $REFRESH"
  fi
fi

for f in "$HOME/.claude/settings.json" "$HOME/.gemini/settings.json"; do
  if [[ -f "$f" ]] && ! grep -q "refresh-thread-board.sh" "$f"; then
    echo "TODO: add a Stop hook in $f that runs: $REFRESH"
  fi
done

# 4. Seed the registry.
echo "Seeding registry…"
NODE="$(command -v node 2>/dev/null || true)"
[[ -z "$NODE" ]] && for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [[ -x "$c" ]] && NODE="$c" && break
done
if [[ -z "$NODE" ]]; then
  echo "node not found — install Node.js, then re-run." >&2
  exit 1
fi
"$NODE" "$REPO_ROOT/scripts/scan-session-history.mjs" --days 30 >/dev/null
"$NODE" "$REPO_ROOT/scripts/reconcile-threads.mjs" >/dev/null

# 5. LaunchAgent (macOS only — Linux users can run serve-thread-board.mjs
#    via systemd or directly; we don't auto-install that yet).
if [[ "$INSTALL_SERVER" -eq 1 ]] && [[ "$(uname)" == "Darwin" ]]; then
  "$REPO_ROOT/scripts/install-thread-board-launchagent.sh" --port "$PORT"
elif [[ "$INSTALL_SERVER" -eq 1 ]]; then
  echo
  echo "To run the board server, start it manually:"
  echo "  node $REPO_ROOT/scripts/serve-thread-board.mjs --port $PORT"
fi

echo
echo "Done. Board: http://127.0.0.1:$PORT (once the server is running)"
