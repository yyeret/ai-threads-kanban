# Thread: Goal Network POC

- **Thread ID:** `goalnet202607`
- **Origin Chat:** `thread://019f4b1f-90e5-7892-80e1-e35bc6c4c2eb`
- **Starting Prompt:** "continue Design goal-driven agent app here - let's evolve the ai-threads-kanban. let's revive it, make it agent-accessible, and apply outcome-framing / outcome mapping to extract a goal network from the work I've been doing in my ai threads."
- **Stage:** `Review / Ship`
- **Status:** `In Progress`
- **Plan File:** `plans/2026-07-10-goal-network-poc.md`
- **Next Step:** Review the generated goal-network artifacts and decide whether to add correction overrides before a `/goals` UI.
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
