# Next Steps: AI Threads Kanban

This document tracks planned features, refactoring tasks, and future directions for the `ai-threads-kanban` project.

## Planned Features

### 1. Goal Network Extraction POC
- **Goal:** Let Yuval and agents inspect AI thread history as a network of goals, child outcomes, evidence, assumptions, blockers, and next-best actions.
- **Approach:** Use the static extractor to produce inspectable Markdown/JSON goal-network artifacts before building UI.
- **Why first:** This tests whether a goal-first view changes prioritization and resume quality without committing to a heavier app architecture.
- **Next:** Review generated artifacts, then add file-backed goal correction overrides if the deterministic grouping is useful but too coarse.

### 2. Automated LLM Title & Next Step Generation
- **Goal:** Move the generation of display titles and next steps from out-of-band scripts into a scheduled, automatic agent/skill run.
- **Approach:** Create a periodic skill script that scans active threads lacking names/steps, queries an LLM (via Gemini/Claude), and saves them to the repo's thread folders.

### 3. Real SLE Measurements
- **Goal:** Replace the current static staleness thresholds with measured Service Level Expectations (SLEs).
- **Approach:** Update the reconciler to record timestamps of stage transitions in `active-threads.jsonl` and calculate actual flow metrics.

### 4. Installer Support for Linux
- **Goal:** Add auto-start and systemd service creation in `install.sh` for Linux servers.

### 5. Cross-Machine Sync Improvement
- **Goal:** Reduce conflicts when multiple machines sync to the same folder via Google Drive.
- **Approach:** Implement a file-locking or merge mechanism for `active-threads.jsonl` to prevent last-writer-wins conflicts.
