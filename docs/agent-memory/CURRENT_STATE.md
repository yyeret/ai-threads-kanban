# Current State: AI Threads Kanban

## Current Focus
We are implementing the **Layered Project Memory and OS Versioning System** (`v0.2.0`). This involves:
- Creating repo-backed state files (`AGENTS.md`, `CLAUDE.md`, and `/docs/agent-memory/*`).
- Updating the reconciler (`reconcile-threads.mjs`) to read and override registry thread details using these workspace-local files.
- Implementing automated version tracking for all harnesses and machines using local and shared config mappings.
- Showing system versions directly in the Kanban board UI.

## Open Loops
- **Reconciler override:** Verify `reconcile-threads.mjs` correctly scans the `/docs/agent-memory/threads/` folders and updates the registry.
- **Harness scanning:** Ensure the installer detects and updates version config files for all active harnesses on the host machine.
- **Dynamic logging:** Verify the server and scanner update `machines.json` dynamically when they run.
- **Board UI integration:** Style and display version status cleanly on the board UI.

## Recent Changes
- Bumped version in `package.json` to `0.2.0`.
- Initialized `AGENTS.md` and `CLAUDE.md` in the project root.
