# Thread: Goal Network POC

- **Thread ID:** `goalnet202607`
- **Origin Chat:** `thread://019f4b1f-90e5-7892-80e1-e35bc6c4c2eb`
- **Starting Prompt:** "continue Design goal-driven agent app here - let's evolve the ai-threads-kanban. let's revive it, make it agent-accessible, and apply outcome-framing / outcome mapping to extract a goal network from the work I've been doing in my ai threads."
- **Stage:** `Review / Ship`
- **Status:** `In Progress`
- **Plan File:** `plans/2026-07-10-goal-network-poc.md`
- **Next Step:** Inspect `/goal-threads` while focused on a filtered goal, move a few obviously misplaced threads, then decide whether thread-goal moves need an undo/reset-to-inferred control.
- **Harness:** `Codex`
- **Machine:** `YUVAL-OFFICE-DESKTOP`

---

## Current State

This thread pivots `ai-threads-kanban` from a stage-first board for AI sessions toward a goal-driven operating surface.

The current repo already provides:

- session scanning across Codex, Claude, Gemini, and Antigravity
- durable thread registry records
- heuristic outcome intent
- stages, status, aging, and next-step prompts
- repo-local thread state files under `docs/agent-memory/threads/`

The new POC should add a file-backed goal network above the thread registry. The first slice should generate inspectable Markdown/JSON before adding a UI.

## Decisions

- Use Compound Engineering for this slice: keep the lightweight SDD goal framing, then add tests and a reusable extraction contract so the next goal-mapping pass is easier.
- Treat static goal-network artifacts as the first proof point.
- Do not build a `/goals` board view until generated goal nodes are useful enough to drive prioritization.
- Keep goal state file-backed and agent-readable; do not introduce a database for the POC.

## Open Questions

- Which registry location should own generated `goal-network.json` and `goal-network.md`: shared registry root, repo docs, or both?
- Should the extractor use a deterministic rule-based first pass only, or allow an LLM enrichment pass after the deterministic pass?
- What correction workflow should let Yuval rename, merge, split, or reject inferred goal nodes?

## Progress Log

- 2026-07-10: Created lightweight SDD plan and repo-local thread state for the goal-network POC.
- 2026-07-10: Implemented deterministic `extract-goal-network.mjs`, added tests, and captured `docs/goal-network-extraction-contract.md` as the Compound Engineering artifact.
- 2026-07-10: Ran `npm run goals` against the shared registry; generated 9 goal nodes from 111 threads at `H:\My Drive\Yeret Agility\agent-memory\projects\agent-threads\goal-network.md`. All goals have resume prompts; the largest gap is a 50-thread `Other / Unsorted` goal that needs correction or better classification before UI work.
- 2026-07-14: Rebasing onto `origin/main` revealed the reviewed-override implementation already landed. Applied reviewed batch-5 overrides in the shared registry, regenerated the goal network, and reduced `Other / Unsorted` from 30 remaining threads to 0. Current output: 15 goals from 104 threads.
- 2026-07-15: Added the first weekly goal-progress review loop: `npm run goals:review` refreshes the goal network, evaluates progress/observability/blockers, writes `goal-review-state.json`, appends `goal-review-history.jsonl`, writes `goal-review.md`, and stamps each goal in `goal-network.json` with `weekly_review`. `npm run goals:loop` can run the same cycle weekly with local notification.
- 2026-07-15: Added board-level goal management: list/Kanban thread views now show goal badges and can filter by goal, `/goals` provides an OKR Kanban lifecycle board using Considering/Exploring → Planning/Committing → In Progress → Review/Adaptation → Done, and goal drag/drop persists reviewed lifecycle state through `goal-overrides.json` before regenerating `goal-network.json`.
- 2026-07-15: Added `/goal-threads`, a goal-bucket board for moving threads between goals. Dragging a thread into another goal writes `thread_overrides.<thread_id>.goal_id` to `goal-overrides.json`, rebuilds `goal-network.json`, and updates the same goal badges/filters used by the thread board.
