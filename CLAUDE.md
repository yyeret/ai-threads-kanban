# Claude Code Instruction Adapter

This file provides specific instructions for Claude Code when operating inside the `ai-threads-kanban` repository.

## Harness Constraints & Environment

1. **Global Soul:** Always respect the cross-harness constitution in [SOUL.md](file:///C:/Users/yuval/agent-memory/SOUL.md).
2. **Commands & Hooks:**
   - Claude Code CLI operates locally. The Stop hook for Claude Code runs `scripts/refresh-thread-board.ps1` (or `.sh`) to automatically update the Kanban board when you exit.
   - Slash commands `/thread-state`, `/finish-thread`, and `/track-thread` are available in this harness. Use them to manage card state from your prompt.

## Project Memory Protocol

Do not rely on Claude Code's internal memory or transient history. You must maintain:
- `/docs/agent-memory/CURRENT_STATE.md` — Active focus, open loops, and blockers.
- `/docs/agent-memory/NEXT_STEPS.md` — What we will do next.
- `/docs/agent-memory/threads/<thread-slug>/thread-state.md` — The specific state, decisions, and reflections for the current thread you are running. Find your current thread ID by running the scanner or checking `active-threads.jsonl`.

## OS Versioning Rules

- If you modify the installers, scanner, reconciler, or server, you **must** bump the version in `package.json`.
- Run `powershell -ExecutionPolicy Bypass -File scripts/install.ps1` (or `scripts/install.sh` on macOS) to deploy your changes and register the updated version in local configuration files and the shared `machines.json` registry.

## Verification & Testing

- Before concluding a task, run the test suite:
  ```bash
  npm test
  ```
- Make sure all tests pass and verify that your changes do not break scanning or reconciliation.
