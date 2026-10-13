# Repository instructions

Use the configured model; do not assign fixed repository roles by vendor or model version.

## Build and test
- Install dependencies: `npm install`
- Run tests: `npm test`

## Shared Collaboration Protocols

All agents working on this repository must strictly adhere to the following rules:

1. **Constitutional Alignment:** Respect `~/agent-memory/SOUL.md` for core voice, stance, and decision-making guidelines.
2. **Layered Memory Maintenance:** Do not let transcripts be the sole memory. Maintain `/docs/agent-memory/CURRENT_STATE.md` (active focus/loops), `/docs/agent-memory/NEXT_STEPS.md` (next steps), and specific thread folders under `/docs/agent-memory/threads/<thread-slug>/thread-state.md` during or at the end of each session.
3. **OS Version Tracking:** When making code changes that affect scanner, reconciler, server, or installers, increment the version in `package.json`, and run `powershell -ExecutionPolicy Bypass -File scripts/install.ps1` (or `scripts/install.sh` on macOS) to deploy your changes and update configurations.
4. **Git Discipline:** Keep commits clean and focused. Reference thread slugs or commit hashes in thread state files.
