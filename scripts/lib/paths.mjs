// Shared path resolution. The thread board needs to know where to put its
// durable state (the registry, board markdown, next-steps map, etc).
//
// Resolution order:
//   1. AGENT_THREADS_OUTPUT_DIR  — direct override, used by tests and CI.
//   2. AI_AGENT_MEMORY_ROOT / AGENT_MEMORY_ROOT — for users already running
//      a shared agent-memory vault; we drop our project under
//      <root>/projects/agent-threads/.
//   3. ~/.config/ai-threads-kanban/registry-root — a one-line text file
//      written by `scripts/install.sh|ps1`, the official self-contained
//      install path for users without a pre-existing memory vault.
//   4. ~/.local/share/ai-threads-kanban  (POSIX) or
//      %LOCALAPPDATA%\ai-threads-kanban  (Windows) — last-resort default
//      so the scripts never fail on a fresh machine. The installer will
//      usually have written #3 first.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();

export function resolveRegistryDir() {
  if (process.env.AGENT_THREADS_OUTPUT_DIR) {
    return path.resolve(process.env.AGENT_THREADS_OUTPUT_DIR);
  }
  const memoryRoot = process.env.AI_AGENT_MEMORY_ROOT || process.env.AGENT_MEMORY_ROOT;
  if (memoryRoot) {
    return path.join(path.resolve(memoryRoot), "projects", "agent-threads");
  }
  const configPath = path.join(home, ".config", "ai-threads-kanban", "registry-root");
  if (fs.existsSync(configPath)) {
    const root = fs.readFileSync(configPath, "utf8").trim();
    if (root) return path.resolve(root);
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(local, "ai-threads-kanban");
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, "ai-threads-kanban");
}
