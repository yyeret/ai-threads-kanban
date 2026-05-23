---
description: Force-track the current AI work thread on the board
---

Force **this** thread (the session you are in) to be actively tracked on the
AI thread registry / board, overriding the classifier if it left the thread in
Funnel / Triage.

Optional argument `$ARGUMENTS`: a short note for *why* the override
(e.g. "important — small but high-leverage").

Steps:

1. Run from the **current working directory** — do NOT `cd` anywhere.
   `--here` identifies the thread by the session's cwd:

   ```bash
   node "{{REPO_ROOT}}/scripts/edit-thread.mjs" --here --track
   ```

   If the user supplied a note, also pass `--note "<note>"`.
2. Report which thread is now force-tracked.
