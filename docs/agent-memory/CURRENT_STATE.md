# Current State: AI Threads Kanban

## Current Focus
We are reviving `ai-threads-kanban` as the first POC for **goal-driven development**: using AI thread history to infer a file-backed goal network above the existing stage-first thread board.

The active slice is the **Goal Network POC**:
- Extract top-level goals and child outcomes from existing AI thread records.
- Separate activity evidence from traction evidence.
- Give each goal an agent-readable resume prompt and supporting thread references.
- Prove the static Markdown/JSON artifact is useful before building a `/goals` UI.

The previous **Layered Project Memory and OS Versioning System** (`v0.2.0`) remains relevant but is no longer the active product direction for this session.

## Open Loops
- **Artifact review:** Inspect the generated goal-network Markdown/JSON for 5-10 representative goals and mark incorrect merges/splits/names.
- **Correction path:** Decide whether to add a goal override map for merge/split/rename decisions before building a `/goals` UI.
- **Reconciler override:** Verify `reconcile-threads.mjs` correctly scans the `/docs/agent-memory/threads/` folders and updates the registry.
- **Harness scanning:** Ensure the installer detects and updates version config files for all active harnesses on the host machine.
- **Dynamic logging:** Verify the server and scanner update `machines.json` dynamically when they run.

## Recent Changes
- Bumped version in `package.json` to `0.2.0`.
- Initialized `AGENTS.md` and `CLAUDE.md` in the project root.
- Added `plans/2026-07-10-goal-network-poc.md` and `docs/agent-memory/threads/goal-network-poc/thread-state.md` for the new goal-network POC direction.
- Added deterministic goal-network extraction plus a reusable extraction contract as the Compound Engineering artifact.
