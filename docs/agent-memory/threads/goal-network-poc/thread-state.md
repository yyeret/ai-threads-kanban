# Thread: Goal Network POC

- **Thread ID:** `goalnet202607`
- **Origin Chat:** `thread://019f4b1f-90e5-7892-80e1-e35bc6c4c2eb`
- **Starting Prompt:** "continue Design goal-driven agent app here - let's evolve the ai-threads-kanban. let's revive it, make it agent-accessible, and apply outcome-framing / outcome mapping to extract a goal network from the work I've been doing in my ai threads."
- **Stage:** `Specify`
- **Status:** `In Progress`
- **Plan File:** `plans/2026-07-10-goal-network-poc.md`
- **Next Step:** Review and approve the lightweight SDD plan, then implement the first static goal-network extraction slice.
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

- Use Lightweight SDD for the first slice because the main uncertainty is value and usefulness, not implementation feasibility.
- Treat static goal-network artifacts as the first proof point.
- Do not build a `/goals` board view until generated goal nodes are useful enough to drive prioritization.
- Keep goal state file-backed and agent-readable; do not introduce a database for the POC.

## Open Questions

- Which registry location should own generated `goal-network.json` and `goal-network.md`: shared registry root, repo docs, or both?
- Should the extractor use a deterministic rule-based first pass only, or allow an LLM enrichment pass after the deterministic pass?
- What correction workflow should let Yuval rename, merge, split, or reject inferred goal nodes?

## Progress Log

- 2026-07-10: Created lightweight SDD plan and repo-local thread state for the goal-network POC.
