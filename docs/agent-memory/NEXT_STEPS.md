# Next Steps: AI Threads Kanban

This document tracks planned features, refactoring tasks, and future directions for the `ai-threads-kanban` project.

## Planned Features

### 1. Automated LLM Title & Next Step Generation
- **Goal:** Move the generation of display titles and next steps from out-of-band scripts into a scheduled, automatic agent/skill run.
- **Approach:** Create a periodic skill script that scans active threads lacking names/steps, queries an LLM (via Gemini/Claude), and saves them to the repo's thread folders.

### 2. Real SLE Measurements
- **Goal:** Replace the current static staleness thresholds with measured Service Level Expectations (SLEs).
- **Approach:** Update the reconciler to record timestamps of stage transitions in `active-threads.jsonl` and calculate actual flow metrics.

### 3. Installer Support for Linux
- **Goal:** Add auto-start and systemd service creation in `install.sh` for Linux servers.

### 4. Cross-Machine Sync Improvement
- **Goal:** Reduce conflicts when multiple machines sync to the same folder via Google Drive.
- **Approach:** Implement a file-locking or merge mechanism for `active-threads.jsonl` to prevent last-writer-wins conflicts.
