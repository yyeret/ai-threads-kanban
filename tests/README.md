# Thread Board tests

Integration tests for the AI Thread Board scripts. Each test spins up a
temp `HOME` plus a temp registry dir, runs the real script as a child
process, and inspects the resulting files. This matches how the scripts
are invoked in production and catches the bugs that hit prod this
session — e.g. reconcile wiping `manual_status`, drag-to-Done not
archiving the Codex rollout, prefix compounding.

## Run

```bash
npm test                    # or: node --test tests/
node --test tests/apply-thread-names.test.mjs    # one file
```

Zero dependencies — uses `node:test` from Node 18+ stdlib.

## Coverage today

| File | Locks in |
|---|---|
| `reconcile-threads.test.mjs` | `manual_status` / `manual_tracking` / `manual_area` survive rescan; legacy-stage healing. |
| `apply-thread-names.test.mjs` | `[Stage] title` rename is idempotent; manual-Done archives the rollout and drops the index line; auto-Done does NOT archive; cross-machine paths are a safe no-op. |
| `edit-thread.test.mjs` | `--finish` sets the full archive gate; `--stage` fuzzy-matches; `--note ''` clears. |

Not yet covered (worth adding when the area changes):

- `scan-session-history.mjs` classifier — needs realistic Codex/Claude
  rollout fixtures to exercise.
- `serve-thread-board.mjs` HTTP handlers — `handleSetStage` Done flip in
  particular. Would need to start the server on a random port.
- Git-aware Done detection — needs a fixture repo.

## Adding a test

Use the helpers in `helpers.mjs`:

- `makeWorkspace()` — tmp `HOME` + registry dir with the right env vars.
- `seedCodexSession(home, {id, threadName, ...})` — fake rollout file + index entry.
- `makeThreadRecord(overrides)` — minimal valid registry record.
- `runScript(name, env, args)` — invoke a script with the workspace env.
- `readJsonl` / `writeJsonl` — file-IO sugar.

Each test should clean up with `t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }))`.
