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
- `confidence`: `low`, `medium`, or `high`
- `supporting_threads`: thread references and resume/transcript pointers
- `child_outcomes`: one outcome statement per supporting thread
- `assumptions`: inferred review assumptions
- `activity_evidence`: work-progress evidence
- `traction_evidence`: outcome/progress evidence
- `blockers`: blocked/waiting thread signals
- `next_actions`: explicit or generated next actions
- `resume_prompt`: copy-paste `/goal` prompt

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

Confidence:

- `high`: at least 3 supporting threads and at least 2 traction evidence items
- `medium`: at least 2 supporting threads or at least 1 traction evidence item
- `low`: everything else

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
      "area": "Display area"
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
