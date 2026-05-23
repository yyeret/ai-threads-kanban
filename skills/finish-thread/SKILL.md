---
name: finish-thread
description: Mark an AI work thread as finished on the thread registry/board — moves it to Done / Archive and stops it from showing as active in-flight work. Use when a thread is genuinely complete and should leave the active board.
---

# Finish Thread

## Outcome

Mark a thread complete in the AI thread registry
(`<agent-memory>/projects/agent-threads/active-threads.jsonl` + `active-threads.md`).
The thread moves to `Done / Archive Candidates`, its tracking decision becomes
`archive`, and it drops out of the "Active Threads" section of the board. These
are stored as manual fields and survive every rescan.

## When to use

- A thread is genuinely finished (shipped, decided, or abandoned on purpose) and
  should stop showing up as in-flight work.
- This is the "stop starting, start finishing" close-out action.

## Workflow

1. Identify the thread — list the registry if unsure of the id:
   `node scripts/edit-thread.mjs --list`
2. Mark it finished (`--match` is a `thread_id` prefix or title substring and
   must match exactly one thread):
   `node scripts/edit-thread.mjs --match "<id-or-title>" --finish`
3. Optionally record how it ended: add `--note "shipped in PR #42"`.
4. The script rewrites the registry and re-renders the board.

## Notes

- Run from the `ai-skill-library` repo root. If `node` is not on PATH, use the
  full path (`"C:\Program Files\nodejs\node.exe"` on this machine).
- `--finish` is reversible: use `skills/thread-state` to move the thread back to
  an active stage if it was closed by mistake.
