Mark **this** thread (the session you are in) as finished on the AI thread
registry / board. It moves to `Done / Archive Candidates` and (on Codex) the
session is archived in the harness picker.

Optional argument $ARGUMENTS: a short note for why / how it ended.

Steps:

1. Run from the **current working directory** — do NOT cd anywhere.
   `--here` identifies the thread by the session's cwd:

       node "{{REPO_ROOT}}/scripts/edit-thread.mjs" --here --finish

   If the user supplied a note, also pass `--note "<note>"`.
2. Report which thread was finished. If the script reports no thread for the
   current directory, the session is not scanned yet — ask the user to retry
   after another turn or two.
