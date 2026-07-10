# Decision Log: AI Threads Kanban

This document records the key architectural, design, and styling decisions made in the `ai-threads-kanban` project.

---

## Decisions

### 1. Unified Shared Registry Root
- **Decision:** All processes (scanners, reconcilers, web servers) on a machine must point to a single, shared directory for the registry.
- **Rationale:** Prevents a "split registry" issue where background tasks run against local AppData while development runs against the shared Drive folder.
- **Implementation:** Persistent setting written to `~/.config/ai-threads-kanban/registry-root` by the installer.

### 2. Zero-Dependency HTTP Web Server
- **Decision:** The board server (`serve-thread-board.mjs`) is written using the built-in Node.js `node:http` module.
- **Rationale:** Minimizes startup overhead, ensures fast page loads, avoids package install friction, and remains highly portable.
- **Implementation:** Zero third-party packages used in the backend.

### 3. Git-Aware Auto-Done Promotion
- **Decision:** Promote threads to "Done" if any referenced commit hashes in their recent assistant messages are reachable on a git remote branch.
- **Rationale:** Automatically updates shipped features without forcing the user to manually mark them done, keeping the board accurate without overhead.
- **Implementation:** Scanner extracts commit hashes and checks `git branch -r --contains <hash>`.

### 4. Workspace-Local Thread State Override
- **Decision:** Support thread-specific folders (`/docs/agent-memory/threads/<slug>/thread-state.md`) in the workspace as the primary source of truth.
- **Rationale:** Allows different harnesses (Claude, Codex, Antigravity) to read and write context in a standard, git-portable format. The board reconciler parses this metadata and overrides registry records automatically.
- **Implementation:** Added workspace parsing in `reconcile-threads.mjs`.

### 5. Automated OS versioning and Deployment Tracking
- **Decision:** Maintain a registry of version information per machine/harness in the shared `machines.json`.
- **Rationale:** Keeps track of the deployed "Yuval-OS" setup on all machines, helping identify out-of-date installations.
- **Implementation:** The installer, server startup, and scanner execution dynamically report their versions.

### 6. Goal Network Above Thread Registry
- **Decision:** The goal-driven development POC should derive a file-backed goal network from the existing thread registry rather than replacing the registry or introducing a database first.
- **Rationale:** The registry already contains thread IDs, stages, outcome intents, notes, next steps, and transcript references. A derived goal layer can be inspected, corrected, and used by agents before committing to UI or persistence complexity.
- **Implementation:** First prove the concept with static generated Markdown/JSON artifacts; defer a `/goals` board view until the artifact changes prioritization or resume behavior.
