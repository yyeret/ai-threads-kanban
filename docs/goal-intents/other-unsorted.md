---
goal_id: other-unsorted
goal_title: Eliminate the uncategorized work bucket
canvas_version: 1
status: challenge
key_results:
  - Other / Unsorted contains 0 active threads for two consecutive weekly reviews.
  - Every newly detected Other / Unsorted thread is moved, suppressed, or escalated as a candidate new goal within the weekly review.
  - No more than 1 active thread remains in Other / Unsorted after manual review.
leading_indicators:
  - Weekly goal review lists each Other / Unsorted thread with a move/suppress/new-goal recommendation.
  - Threads in this bucket are examined for drift from committed goals.
  - New recurring themes are promoted into reviewed goal definitions instead of staying uncategorized.
fit_signals:
  - uncategorized
  - unsorted
  - override
  - classify
  - triage
  - goal network
  - goal bucket
  - move thread
anti_fit_signals:
  - publish
  - article
  - proposal
  - crm
  - skill
  - agent
  - client
  - analytics
  - website
  - personal admin
straying_questions:
  - Is this a real goal, or only evidence that the classifier/overrides are incomplete?
  - Should this thread move to an existing goal, be suppressed as noise, or become a new explicit goal?
  - If Yuval keeps starting threads here, what committed goal is missing or unclear?
---

# Lean Product Canvas Intent: Other / Unsorted

## Outcome-Oriented Goal

Eliminate the uncategorized work bucket so every active thread either supports a reviewed goal, is intentionally suppressed, or exposes a new goal Yuval should explicitly choose or reject.

Leading indicators:

- Classification health: `Other / Unsorted` reaches 0 active threads for two consecutive weekly reviews.
- Review discipline: every thread in this bucket gets a move, suppress, or new-goal recommendation during the weekly review.
- Drift signal: repeated uncategorized themes are escalated to Yuval as either a missing goal or evidence of straying.

## Customer Segments

- Yuval, who needs the board to show intent rather than a pile of leftovers.
- Agents that need a clear decision rule for new or ambiguous work.
- The goal-thread associator, which needs to know when uncertainty is a product signal rather than a classification failure.

## Problem

`Other / Unsorted` is not a business outcome. It hides ambiguity, weak classifier coverage, interrupted sessions, one-off commands, and work that may indicate Yuval is drifting away from stated goals. If this bucket stays large, the goal system cannot be trusted.

## Existing Alternatives

- Leave ambiguous threads in `Other / Unsorted`.
- Manually review them only when the pile becomes embarrassing.
- Overfit classifier rules and accidentally hide genuine new goals.
- Suppress noisy threads without asking whether a new pattern is emerging.

## Unique Value Proposition

The uncategorized bucket becomes a weekly learning loop: move what fits, suppress what is noise, and surface what might be a new goal or strategic drift.

## Solution Shape

- Review all `Other / Unsorted` threads weekly.
- Apply move/suppress/new-goal recommendations.
- Promote recurring themes into reviewed goal canvases.
- Ask Yuval explicitly when repeated work does not fit current goals.

## Channels / Surfaces

- `/goal-threads`
- `goal-overrides.json`
- `goal-review-state.json`
- `goal-review.md`
- goal intent canvases under `docs/goal-intents/`

## Revenue / Value Logic

The value is focus and trust. A low unsorted count makes the dashboard useful for deciding what to advance, pause, kill, or clarify.

## Cost Structure

- Weekly review of ambiguous threads.
- Manual approval for new-goal creation or suppression rules.
- Occasional classifier/override maintenance.

## Unfair Advantage

Because the board sees real cross-harness work, unsorted threads reveal actual operating drift quickly.

## Thread Association Guidance

Strong fit:

- Threads specifically about classifying, reviewing, moving, suppressing, or improving uncategorized goal mappings.
- Short-lived triage threads whose main output is a better goal-map rule.

Weak fit:

- Any durable business, content, sales, client, agent-infra, analytics, website, or admin work. Those should move to explicit goals.

Possible misfit:

- Almost everything. This goal is a cleanup/challenge goal, not a permanent operating category.

## Suggested `/goal` Loop Prompt

```text
/goal Drive toward: Eliminate the uncategorized work bucket so every active thread supports a reviewed goal, is intentionally suppressed, or exposes a new goal Yuval should explicitly choose or reject.
Leading indicators: Other / Unsorted reaches 0 active threads for two consecutive weekly reviews; every unsorted thread gets move/suppress/new-goal recommendation; repeated uncategorized themes are escalated as missing goals or drift.
Each cycle: review docs/goal-intents/other-unsorted.md, inspect every associated thread, recommend move/suppress/new-goal/ask-Yuval, update goal-overrides where safe, and report what the unsorted pile says about goal clarity.
```
