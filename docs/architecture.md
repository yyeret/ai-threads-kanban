# Architecture

How the AI Threads Kanban board is put together. The user-facing flow
is in the top-level [README](../README.md); this doc is for contributors
and operators who want to understand the moving parts.

## Pieces

| File | Role |
|---|---|
| `scripts/scan-session-history.mjs` | Scans native harness session history → per-session cards (`threads.<host>.jsonl`). |
| `scripts/reconcile-threads.mjs` | Clusters cards into a durable thread registry (`active-threads.jsonl` + `active-threads.md`). Fuzzy intent clustering, intent-area tagging, manual-field preservation. |
| `scripts/extract-goal-network.mjs` | Derives a deterministic goal network (`goal-network.json` + `goal-network.md`) from the active thread registry. |
| `scripts/apply-thread-names.mjs` | Stamps `[Stage] title` onto Codex session names; archives finished Codex sessions. |
| `scripts/set-display-titles.mjs` | Loads outcome-framed display titles into the registry from a JSON map. |
| `scripts/set-next-steps.mjs` | Loads suggested next-step prompts into the registry from a JSON map. |
| `scripts/refresh-thread-board.ps1` / `.sh` | Runs scan + reconcile + apply-names. Wired into each harness's Stop hook. |
| `scripts/edit-thread.mjs` | Applies manual nudges (stage / finish / track / note / area) to the registry. |
| `scripts/serve-thread-board.mjs` | Local web board — list + kanban + ipsum views, drag-and-drop restage, resume, log. |
| `scripts/lib/paths.mjs` | Shared registry-root resolver (env → config file → platform default). |
| `skills/{thread-state,finish-thread,track-thread}` | Slash-command sources installed into each harness. |

## Registry

`active-threads.jsonl` is the durable source of truth — one record per
logical thread, keyed by `thread_id = sha1(repo_key + intent_hash)`.
`intent_hash` is derived from the normalized first real user prompt, so
multiple sessions on the same intent collapse into one thread.

Reconcile refreshes activity-derived fields (stage, staleness, sessions)
on every run but preserves manual fields — `manual_stage`,
`manual_status`, `manual_tracking`, `manual_area`, `notes`. A human
correction is never overwritten by a rescan.

`active-threads.md` is the rendered board grouped by stage. `[AGING]`
marks threads idle past the interim staleness SLE for their stage.

## Goal network

`goal-network.json` and `goal-network.md` are derived artifacts above the
thread registry. Run:

```bash
npm run goals
```

The first implementation is deterministic: it groups included threads by
`intent_area`, lists child outcomes from each thread's `outcome_intent`,
separates activity evidence from traction evidence, and generates a
copy-paste `/goal` prompt per goal. Done/archive threads are omitted by
default; use `node scripts/extract-goal-network.mjs --include-done` for
historical or case-study analysis.

The extraction contract, schema, and correction path live in
[`docs/goal-network-extraction-contract.md`](goal-network-extraction-contract.md).

The web board reads `goal-network.json` as a derived management layer. Thread
cards display goal badges and the list/Kanban thread views can filter by goal
without mutating `active-threads.jsonl`.

The `/goals` board manages goal lifecycle state using an OKR Kanban flow:
`Considering / Exploring → Planning / Committing → In Progress →
Review / Adaptation → Done`. Dragging a goal writes
`goals.<goal_id>.lifecycle_stage` to `goal-overrides.json` and regenerates the
goal network. Traction status is red by default and moves to yellow/green from
evidence unless a reviewed override sets `traction_status`.

The `/goal-threads` explorer manages thread-to-goal assignment. It renders the
goal list in a left pane, shows only the selected goal's current threads in the
right pane, and lets a reviewed drag/drop write
`thread_overrides.<thread_id>.goal_id` to `goal-overrides.json`. The server
immediately regenerates `goal-network.json` so badges, filters, and the
explorer converge on the same reviewed state. The left pane also exposes a
manual goal form; `/create-goal` writes `goals.<goal_id>` to
`goal-overrides.json`, and the extractor keeps those manually-defined goals
visible even before a supporting thread is moved into them.

Goal intent canvases live in `docs/goal-intents/<goal-id>.md`. A goal can
reference one through `goals.<goal_id>.intent_canvas_ref`; the weekly review
also falls back to that file naming convention. The canvas provides key
results, leading indicators, fit signals, anti-fit signals, and straying
questions that the weekly loop uses to evaluate progress and challenge whether
associated threads still belong with the goal.

## Lifecycle stages

Left-to-right flow: `Funnel / Triage → On Hold → Specify → Plan →
Implement → Review / Ship → Done / Archive Candidates`.

- **Funnel / Triage** is a muted holding lane — every thread on this
  board has already started, so there is no pre-work intake. Funnel
  instead holds already-started threads that might become worth
  tracking but you have not committed to yet.
- **On Hold** is a manual-only parking lane — the classifier never
  assigns it. Drag a thread there to take it off your plate; it is
  muted and never ages.
- **`blocked`** is a separate flag, not a stage — the scanner sets it
  when a session ends on a usage/rate limit; the thread keeps its flow
  stage and is flagged.

Stage and tracking decisions are heuristic — treat them as review
prompts, not source-of-truth workflow state.

## Harness-side effects

`apply-thread-names.mjs` writes two things into each harness's own state:

- **Codex** — rewrites `thread_name` in `~/.codex/session_index.jsonl`
  to `[Stage] display_title`. Threads with `manual_status="done"` are
  archived natively: the rollout file moves from `~/.codex/sessions/…/rollout-*.jsonl`
  to `~/.codex/archived_sessions/` and the index line is dropped,
  mirroring the box-icon archive in the Codex picker. Cross-machine
  safe: only rollout files that exist locally are moved.
- **Claude Code** — *not feasible*. The picker builds its label from
  the first user message in each project session JSONL; there is no
  separate title field to write. `~/.claude/history.jsonl` stores
  prompt history (one row per prompt, multiple per session), not
  session titles.
- **Gemini** — no per-session title to write.

Display titles are generated by an LLM pass (out-of-band today, planned
as a periodic skill). `display-titles.json` in the registry folder is the
map; `set-display-titles.mjs` loads it.

## Suggested next step

Each active thread can carry a `next_step` — a paste-ready prompt to
take it one step toward done. The board shows it on the card; the
**continue** button copies it to the clipboard while opening the session.
`set-next-steps.mjs` loads a `next-steps.json` map; the generator is also
out-of-band (planned periodic skill).

## Git-aware Done detection

When a thread in Implement or Review/Ship references a commit hash in
its recent turns, the scanner checks whether that commit is on a remote
branch. If yes, the work shipped — the thread is promoted to Done
regardless of how the session phrased it. **Auto-Done does NOT trigger
harness archive** (that gate is `manual_status="done"`, set only by
explicit `/finish-thread` or drag-to-Done) — so heuristic promotion
stays reversible.

The Done lane is faded, idle time is hidden on done cards, and threads
done more than 14 days drop off the board entirely.

## Path resolution

`scripts/lib/paths.mjs` resolves the registry directory in this order:

1. `AGENT_THREADS_OUTPUT_DIR` (used by tests).
2. `AI_AGENT_MEMORY_ROOT` or `AGENT_MEMORY_ROOT` →
   `<root>/projects/agent-threads/`.
3. `~/.config/ai-threads-kanban/registry-root` (one-line file written
   by the installer).
4. Platform default: `~/.local/share/ai-threads-kanban` (POSIX) or
   `%LOCALAPPDATA%\ai-threads-kanban` (Windows).

## Web board internals

`serve-thread-board.mjs` is a zero-dependency `node:http` server. Routes:

- `/` — list view (stages collapsed, Done collapsed by default).
- `/kanban` — kanban view, HTML5 drag-and-drop.
- `/goals` — goal lifecycle Kanban, HTML5 drag-and-drop.
- `/goal-threads` — two-pane goal/thread explorer for moving threads between
  goals, HTML5 drag-and-drop.
- `/kanban-ipsum` — same shape, deterministic placeholder titles.
- `/continue?id=<thread_id>&step=1` — opens the session's working dir
  in a terminal, runs its resume command, optionally copies the next-step.
- `/log?id=<thread_id>` — rendered transcript (preamble stripped,
  head + tail with middle collapsed).
- `/set-stage?id=<thread_id>&stage=<name>` — drag-drop endpoint;
  writes `manual_stage`, also flips `manual_status` to `done` when
  dropped on Done.
- `/set-goal-stage?id=<goal_id>&stage=<name>` — goal drag-drop endpoint;
  writes reviewed lifecycle state to `goal-overrides.json` and regenerates
  `goal-network.json`.
- `/set-thread-goal?id=<thread_id>&goal=<goal_id>` — thread-to-goal drag-drop
  endpoint; writes a reviewed goal override for the thread and regenerates
  `goal-network.json`.
- `/refresh` — re-runs scan + reconcile.
- `/card?id=<thread_id>` — modal detail.

## Known limitations

- Flow-time SLEs are interim (staleness-based). Real per-stage SLEs
  need stage-transition timestamps, which the registry will accumulate
  over time.
- Intent clustering merges exact `thread_id` matches plus same-repo
  fuzzy intent matches (Jaccard ≥ 0.55). Cross-repo re-runs of one
  intent still split.
- Cross-machine merge is eventually consistent (shared-folder sync latency).
- Codex exposes only a `Stop` hook, so mid-session state changes there
  surface on the next session stop rather than live.
- Claude Code sessions cannot be renamed in the harness picker (no
  title field).
- Display-title and next-step generation are out-of-band today; the
  auto-generation pass is planned as a periodic skill.
- Goal-network extraction is deterministic and coarse. It needs a
  file-backed correction path for merge/split/rename decisions before a
  `/goals` UI becomes a source of truth.
