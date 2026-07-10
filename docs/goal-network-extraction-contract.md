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

`goal-network.json` schema version `1`:

```json
{
  "schema_version": 1,
  "generated_at": "ISO-8601 timestamp",
  "source_registry": "path to active-threads.jsonl",
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

1. Add or adjust `intent_area` or manual notes on the source thread record.
2. Add repo-local thread state under `docs/agent-memory/threads/<slug>/`.
3. Add a future override map for goal merge/split/rename decisions.
4. Only then add LLM enrichment for naming or summarization.

Do not make the UI the correction source of truth until file-backed overrides
exist and are tested.

## Validation Checklist

- `npm test` passes.
- `npm run goals` writes both output files.
- Every goal has at least one supporting thread.
- Every goal has a resume prompt.
- Activity and traction evidence are separate arrays.
- Done/archive threads are omitted by default and included with `--include-done`.
