# Plan: Goal Network POC

Date: 2026-07-10
Mode: Compound Engineering
Source thread: `thread://019f4b1f-90e5-7892-80e1-e35bc6c4c2eb`

## 1. Outcome-Oriented Goal & Leading Indicators

Yuval and collaborating agents can inspect AI thread history as a goal network: active work is grouped by outcome, connected to supporting threads, assumptions, evidence, blockers, and next-best actions.

Leading indicators:

- Goal coverage: at least 10 active or recent threads map to goal nodes with confidence and evidence snippets.
- Outcome quality: at least 3 top-level goals are phrased as observable behavior changes or business outcomes, not tool outputs.
- Agent accessibility: each goal node has a copy-paste resume prompt and points to the supporting thread records/transcripts.
- Traction separation: the generated view separates activity evidence from traction evidence for every top-level goal where evidence exists.

## 2. Users & User Outcomes

Primary users:

- Yuval, deciding which AI-assisted work matters next.
- Codex, Claude, Gemini, and Antigravity agents resuming work across machines.
- Future case-study readers evaluating goal-driven development as a practical operating model.

Jobs to be done:

- When Yuval has many active AI threads, he can see which higher-level goals they serve and where traction is or is not visible.
- When an agent resumes work, it can start from the goal context and evidence, not only from a raw chat transcript or board lane.
- When this becomes a case study, the product can show the shift from thread management to outcome management using its own development history.

## 3. Solutions & Scenarios

P1 scenario: goal extraction from existing thread registry

- Read `active-threads.jsonl`, rendered board data, and available transcript summaries.
- Generate a durable goal-network artifact containing goals, child outcomes, supporting threads, assumptions, evidence, blockers, and next actions.
- Store the generated artifact in the registry or repo-local docs so agents can read it without opening the UI.

P1 scenario: agent-accessible resume from a goal

- Each goal node includes a suggested `/goal` loop prompt.
- The prompt points to the goal-network artifact, supporting thread IDs, and current leading indicators.

P2 scenario: board UI goal view

- Add a `/goals` view to the local board after the generated artifact proves useful.
- Let the UI show goals first, then supporting threads, instead of forcing the user to infer goals from cards.

## 4. Hypotheses & LOFAs

Hypothesis 1:
We believe a generated goal network will help Yuval choose the next AI work thread based on outcome traction, which should reduce stale or low-leverage active threads.

Hypothesis 2:
We believe agents can use a file-backed goal network to resume work with less transcript rereading, which should improve cross-harness continuity.

Hypothesis 3:
We believe using `ai-threads-kanban` itself as the first POC will produce a credible case study for goal-driven development, because the product can show its own goal graph and learning evidence.

Leap of Faith Assumptions:

- Thread records and transcripts contain enough semantic signal to infer useful goal groupings.
- Goal grouping can remain inspectable and correctable without requiring a private SaaS database.
- Yuval will make better prioritization decisions from a goal-first view than from a stage-first board alone.
- Agents can reliably use generated goal prompts without drifting into generic planning.

## 5. Conviction Level & Learning

Conviction: Medium.

The repo already has thread records, stage flow, outcome intents, display-title fields, next-step prompts, and file-backed project memory. The uncertain part is whether inferred goal nodes are useful enough to drive decisions rather than becoming another summary artifact.

Most important thing to learn first:

Can a simple extractor produce a goal network from the current registry that Yuval recognizes as useful for deciding what to advance, pause, or kill?

Least amount of work needed:

Generate a static Markdown plus JSON goal-network artifact from the current active thread registry before adding UI or automation.

## 6. Learning Plan

1. Refresh the local registry from available session history.
2. Inspect the shape of current `active-threads.jsonl` records and transcript access.
3. Implement a small goal-network extractor that uses existing fields first: `outcome_intent`, `intent_area`, `stage`, `status`, `notes`, `next_step`, transcript summaries, and recent assistant/user text.
4. Produce `goal-network.json` and `goal-network.md` as inspectable artifacts.
5. Review the artifact manually for 5-10 representative goals and mark gaps before building a UI view.

## 7. Proposed Next Best Action

First implementation slice:

- `[NEW]` Add `scripts/extract-goal-network.mjs`.
- `[NEW]` Add focused tests for grouping, outcome-vs-activity classification, and generated resume prompts.
- `[MODIFY]` Add an npm script such as `npm run goals`.
- `[NEW/GENERATED]` Produce `goal-network.json` and `goal-network.md` in the resolved registry directory or a documented repo-local sample path.
- `[MODIFY]` Update `docs/architecture.md` after the extraction contract is proven.

Do not build the `/goals` UI until the static artifact proves useful.

Implementation result:

- `scripts/extract-goal-network.mjs` now generates `goal-network.json` and `goal-network.md`.
- `npm run goals` generated 9 goal nodes from 111 shared-registry threads.
- `docs/goal-network-extraction-contract.md` captures the reusable extraction schema, heuristics, and correction path.
- Next best action is artifact review plus file-backed correction overrides for the large `Other / Unsorted` group before UI work.

## 8. Suggested `/goal` Loop Prompt

```text
/goal Drive toward: Yuval and collaborating agents can inspect AI thread history as a goal network, with active work grouped by outcome, evidence, assumptions, blockers, and next-best actions.
Leading indicators (target): Goal coverage -> at least 10 active or recent threads mapped to goal nodes with confidence and evidence snippets; Outcome quality -> at least 3 top-level goals phrased as observable behavior changes or business outcomes; Agent accessibility -> every goal node has a copy-paste resume prompt and supporting thread references; Traction separation -> every top-level goal with evidence separates activity evidence from traction evidence.
Source of truth for scope and steps: C:\Users\yuval\Github\ai-threads-kanban\plans\2026-07-10-goal-network-poc.md.
Each cycle: (1) measure every leading indicator against its target and note the current value; (2) if all targets are met, stop and report the outcome as achieved; (3) otherwise pick the single next best action that most moves a lagging indicator, execute it, then re-measure; (4) append a one-line progress entry (date, action, indicator deltas) to C:\Users\yuval\Github\ai-threads-kanban\docs\agent-memory\threads\goal-network-poc\thread-state.md. Stop and ask the human before any irreversible or outward-facing action, and after 3 cycles with no indicator movement.
```
