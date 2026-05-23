---
name: thread-state
description: Move a tracked AI work thread to a different lifecycle stage on the thread registry/board. Use when the auto-classifier put a thread in the wrong stage (Funnel, Specify/Plan, Implement, Review/Ship, Waiting/Blocked, Done) and you want to correct it, or to manually advance a thread.
---

# Thread State

## Outcome

Correct or advance the lifecycle stage of a thread in the AI thread registry
(`<agent-memory>/projects/agent-threads/active-threads.jsonl` + `active-threads.md`).
The stage you set is stored as `manual_stage` and survives every rescan — the
reconciler never overwrites a manual stage with an inferred one.

## When to use

- The native session scanner inferred the wrong stage for a thread.
- You want to deliberately move a thread forward (e.g. into Review/Ship).

## Valid stages

Flow, left to right: `Funnel / Triage` · `On Hold` · `Specify` · `Plan` ·
`Implement` · `Review / Ship` · `Done / Archive Candidates`.

`Funnel / Triage` is the muted holding lane — already-started threads that
might become worth tracking but you have not committed to yet. Everything in
this board has at least started, so there is no pre-work intake stage.

`On Hold` is a manual-only parking lane — the classifier never assigns it.
Move a thread there to take it off your plate; it is muted and never ages.

"Blocked" is not a stage — it is a separate flag the scanner sets when a
session hits a usage/rate limit; it does not change the flow stage.

## Quick path — set the state of the current thread

From inside the session you want to stage, type the slash command:

```
/thread-state done        /thread-state specify        /thread-state funnel
```

It runs `edit-thread.mjs --here`, which scans native harness history first (so a
brand-new thread is registered), then targets the thread whose freshest session
ran in the current working directory. `done` also archives the thread. Append
words after the stage to attach a note: `/thread-state review shipped to prod`.

The command is installed per harness: `~/.claude/commands/thread-state.md`,
`~/.codex/prompts/thread-state.md`, `~/.gemini/commands/thread-state.toml`.

## Workflow — staging another thread

1. Identify the thread. If unsure of its id, list the registry:
   `node scripts/edit-thread.mjs --list`
2. Apply the stage (the `--match` value can be a `thread_id` prefix or a title
   substring; it must match exactly one thread):
   `node scripts/edit-thread.mjs --match "<id-or-title>" --stage "<stage>"`
3. The script rewrites `active-threads.jsonl` and re-renders `active-threads.md`.

Stage names are matched loosely — `--stage implement` or `--stage review` works.
To stage the current session's own thread instead, use `--here` (no `--match`).

## Notes

- Run from the `ai-skill-library` repo root. If `node` is not on PATH, use the
  full path (`"C:\Program Files\nodejs\node.exe"` on this machine).
- To also leave a reason, add `--note "<why>"`.
- See `skills/finish-thread` to mark a thread done, `skills/track-thread` to
  force-track a thread still sitting in Funnel / Triage.
