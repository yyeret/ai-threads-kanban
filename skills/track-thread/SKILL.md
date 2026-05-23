---
name: track-thread
description: Force an AI work thread to be actively tracked on the thread registry/board even if the auto-classifier left it in Funnel / Triage or marked it wait-for-threshold. Use when a session matters but did not trip the automatic tracking heuristics.
---

# Track Thread

## Outcome

Force a thread's tracking decision to `track` in the AI thread registry
(`<agent-memory>/projects/agent-threads/active-threads.jsonl` + `active-threads.md`).
This is stored as `manual_tracking` and survives every rescan.

## When to use

- A session is real, in-flight work but the scanner left it in `Funnel / Triage`
  or marked it `wait-for-threshold` (e.g. a short but important thread, or one
  the heuristics under-counted).
- You want it on the board now rather than waiting for it to cross thresholds.

## Workflow

1. Identify the thread — list the registry if unsure of the id:
   `node scripts/edit-thread.mjs --list`
2. Force tracking (`--match` is a `thread_id` prefix or title substring and must
   match exactly one thread):
   `node scripts/edit-thread.mjs --match "<id-or-title>" --track`
3. Optionally also set its stage with `--stage "<stage>"` (see
   `skills/thread-state`) and a reason with `--note "<why>"`.
4. The script rewrites the registry and re-renders the board.

## Notes

- Run from the `ai-skill-library` repo root. If `node` is not on PATH, use the
  full path (`"C:\Program Files\nodejs\node.exe"` on this machine).
- Forcing `track` does not change the stage; a tracked thread with no better
  signal stays in `Funnel / Triage` until staged via `skills/thread-state`.
