---
description: Set the lifecycle stage of the current AI work thread on the thread board
---

Set the lifecycle stage of **this** thread (the session you are in) on the AI
thread registry / board.

Argument: `$ARGUMENTS`

Steps:

1. Parse `$ARGUMENTS`. The **first word** is the target stage; any remaining
   words are an optional note. Valid stages (loose match, case-insensitive):
   `funnel` · `on-hold` · `specify` · `plan` · `implement` · `review` · `done`.
   If no argument was given, ask which stage to set and stop.
2. Run this from the **current working directory** — do NOT `cd` anywhere.
   `--here` identifies the thread by the session's cwd, so changing directory
   would target the wrong thread:

   ```bash
   node "{{REPO_ROOT}}/scripts/edit-thread.mjs" --here --stage "<stage>"
   ```

   Add `--note "<note>"` only if the user supplied note words.
3. The script auto-scans native harness history first (so a brand-new thread
   gets registered), then re-renders the board. Report the script output:
   which thread was updated and its new stage. `done` also archives the thread.

If the script reports no thread for the current directory, the session is not
scanned yet — tell the user to retry after another turn or two.
