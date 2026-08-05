# Goal Network Extraction Contract

This contract documents the first deterministic goal-network layer above
`active-threads.jsonl`. It is the reusable rule surface for future extractor,
UI, and LLM-enrichment work.

## Purpose

Convert a stage-first AI thread registry into an agent-readable goal network:

- top-level goal nodes
- child outcomes from supporting threads
- activity evidence separated from traction evidence
- blockers and next actions
- resume prompts that start from the goal, not the raw thread list

The first pass is deterministic by design. LLM enrichment can improve naming,
merging, splitting, or evidence summaries later, but it should not be required
to produce a useful artifact.

## Review And Override Lifecycle

The correction loop is intentionally two-step:

1. An LLM proposes goal corrections in a review artifact.
2. A human accepts, edits, or rejects those suggestions.
3. Accepted suggestions are copied into `goal-overrides.json`.
4. `npm run goals` applies only `goal-overrides.json`.

Do not apply `goal-overrides.proposed.json` automatically. Proposed files are
review surfaces, not source-of-truth state.

## Inputs

Primary input:

- `active-threads.jsonl` from the resolved registry directory.

Important fields:

- `thread_id`
- `display_title` or `title`
- `outcome_intent`
- `intent_area`
- `stage`
- `status`
- `tracking_decision`
- `manual_status`
- `where_it_stands`
- `notes`
- `next_step`
- first session `resume`
- first session `transcript_path`

Default inclusion rule:

- include live and recent threads
- exclude threads in `Done / Archive Candidates`
- exclude threads with `tracking_decision: archive`
- exclude threads with `manual_status: done`

`--include-done` may include all registry threads when doing historical or
case-study analysis.

## Outputs

The extractor writes both files to the resolved registry directory:

- `goal-network.json`
- `goal-network.md`

If present, `goal-overrides.json` in the same directory is applied before
grouping. A custom path can be supplied:

```bash
node scripts/extract-goal-network.mjs --overrides path/to/goal-overrides.json
```

`goal-network.json` schema version `1`:

```json
{
  "schema_version": 1,
  "generated_at": "ISO-8601 timestamp",
  "source_registry": "path to active-threads.jsonl",
  "source_overrides": "path to goal-overrides.json or empty string",
  "thread_count": 0,
  "goal_count": 0,
  "goals": []
}
```

Each goal contains:

- `id`: stable slug derived from `intent_area`
- `title`: deterministic top-level goal title
- `outcome_statement`: goal-level behavior/result statement
- `area`: source intent area
- `lifecycle_stage`: review/kanban stage for the goal
- `key_results`: optional human-reviewed key results from overrides
- `leading_indicators`: optional human-reviewed leading indicators from overrides
- `confidence`: `low`, `medium`, or `high`
- `traction_status`: deterministic or override-provided status color
- `supporting_threads`: thread references and resume/transcript pointers
- `child_outcomes`: one outcome statement per supporting thread
- `assumptions`: inferred review assumptions
- `activity_evidence`: work-progress evidence
- `traction_evidence`: outcome/progress evidence
- `blockers`: blocked/waiting thread signals
- `next_actions`: explicit or generated next actions
- `resume_prompt`: copy-paste `/goal` prompt
- `intent_canvas_ref`: optional repo-relative path to a Lean Product Canvas intent document for the goal
- `fit_signals` / `anti_fit_signals`: optional reviewed terms used by the weekly thread-fit review
- `straying_questions`: optional prompts the weekly loop can surface when threads look off-goal
- `agent_role_refs`: optional skill-library role or system skill references that describe which agent/team role should own the goal
- `weekly_review`: added by `npm run goals:review`, containing progress status, metrics, deltas, thread-fit review, and next-best action

## Goal Review Loop

`npm run goals:review` runs one review cycle:

1. Refreshes session history and reconciles the registry.
2. Regenerates `goal-network.json` and `goal-network.md`.
3. Loads the goal intent canvas from `intent_canvas_ref` or `docs/goal-intents/<goal-id>.md` when present.
4. Evaluates each goal against explicit `key_results` / `leading_indicators` from overrides and the canvas, and against deterministic traction/activity/blocker signals otherwise.
5. Reviews associated threads against the canvas `fit_signals` / `anti_fit_signals` and records whether each association looks like a strong fit, weak fit, possible misfit, or impossible to judge.
6. Writes `goal-review-state.json`, appends `goal-review-history.jsonl`, writes `goal-review.md`, and stamps each goal in `goal-network.json` with `weekly_review`.

`npm run goals:loop` runs the same cycle, sends a local notification when the
cycle completes, then sleeps for seven days before repeating.

Review statuses:

- `progressing`: traction evidence increased or the goal has traction plus explicit next actions.
- `no_progress`: activity exists without visible traction movement.
- `unobservable`: the goal has no explicit indicators and no traction evidence.
- `blocked`: one or more blocker signals are present.

## Heuristics

Goal grouping:

- group by `intent_area`
- sort groups by supporting-thread count, then title

Evidence split:

- traction evidence has shipped, passed, pushed, published, validated, merged,
  released, scheduled, qualified, booked, converted, commit, evidence, or
  approved signals
- activity evidence is meaningful progress/status text without traction signals

Framing classification:

- `impact`: business metric or external result language
- `outcome`: actor can do, decide, understand, trust, inspect, or resume
- `output`: named artifact such as script, dashboard, view, JSON, Markdown, repo
- `activity`: build, add, create, implement, fix, update, test, publish, write
- `unknown`: no clear signal

Goal assignment:

- explicit `thread_overrides.<thread_id>.goal_id` wins first and is folded
  through any `goal_overrides` alias
- otherwise, the extractor reviews `repo_key`, first session `cwd`, transcript
  path, title, outcome intent, current state, and next step for strong folder or
  material hints such as `CRM Ops`, `AI Transformation Consulting`,
  `ai-skill-library`, and `yeret-agility-site`
- folder hints are intentionally specific before broad: C-SDD/content-SDD and
  site content work routes by topic before folder, AI-native delivery content
  stays with AI-native delivery systems, generic site content and search work
  route to marketing/discoverability, site implementation work routes to website
  developer, CRM/pipeline folders route to revenue pipeline/outreach,
  skill-library and agent-memory work route to the internal AI operating system
- explicit overrides are not changed by the extractor; disagreement between an
  override and a folder hint should be reviewed as a fit question, not silently
  moved

Confidence:

- `high`: at least 3 supporting threads and at least 2 traction evidence items
- `medium`: at least 2 supporting threads or at least 1 traction evidence item
- `low`: everything else

Goal lifecycle:

- the board uses the OKR Kanban flow `Considering / Exploring`,
  `Planning / Committing`, `In Progress`, `Review / Adaptation`, `Done`
- default lifecycle is `Considering / Exploring`
- dragging a goal on `/goals` writes `goals.<goal_id>.lifecycle_stage` to
  `goal-overrides.json` and regenerates the derived network
- dragging a thread on `/goal-threads` writes
  `thread_overrides.<thread_id>.goal_id` to `goal-overrides.json` and
  regenerates the derived network
- traction is red by default, then earned from outcome evidence or a reviewed
  `goals.<goal_id>.traction_status` override

## Correction Path

When the deterministic network is useful but wrong, correct in this order:

1. Generate `goal-overrides.proposed.json` and `goal-review-suggestions.md`.
2. Review the suggestions.
3. Copy accepted entries into `goal-overrides.json`.
4. Re-run `npm run goals`.
5. If the same correction repeats, update source classification or thread-state
   so the override is no longer needed.

Do not make the UI the correction source of truth until file-backed overrides
exist and are tested.

## Override Schema

`goal-overrides.json`:

```json
{
  "schema_version": 1,
  "goals": {
    "goal-id": {
      "title": "Human-readable outcome title",
      "outcome_statement": "Outcome statement used in Markdown and resume prompts.",
      "area": "Display area",
      "lifecycle_stage": "In Progress",
      "traction_status": "yellow",
      "key_results": ["Lagging outcome to evaluate weekly"],
      "leading_indicators": ["Observable weekly signal"],
      "intent_canvas_ref": "docs/goal-intents/goal-id.md",
      "fit_signals": ["term that indicates a good thread fit"],
      "anti_fit_signals": ["term that indicates a likely misfit"],
      "straying_questions": ["Question to ask when work keeps landing outside this goal"],
      "agent_role_refs": ["role-sdr-outreach"]
    }
  },
  "thread_overrides": {
    "thread_id": {
      "goal_id": "goal-id",
      "suppress": false,
      "rationale": "Why this reviewed correction exists."
    }
  },
  "goal_overrides": {
    "existing-goal-id": {
      "goal_id": "replacement-goal-id"
    }
  }
}
```

Supported corrections:

- define a new goal node in `goals`
- manage a goal through the lifecycle with `goals.<goal_id>.lifecycle_stage`
- override a goal traction color with `goals.<goal_id>.traction_status`
- move a thread to a goal with `thread_overrides.<thread_id>.goal_id`
- suppress non-goal noise with `thread_overrides.<thread_id>.suppress`
- rename/merge an existing deterministic group with `goal_overrides`

## Validation Checklist

- `npm test` passes.
- `npm run goals` writes both output files.
- Every goal has at least one supporting thread.
- Every goal has a resume prompt.
- Activity and traction evidence are separate arrays.
- Done/archive threads are omitted by default and included with `--include-done`.
- Proposed overrides are not applied unless they are copied to
  `goal-overrides.json`.
