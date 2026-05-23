// Regression tests for scripts/apply-thread-names.mjs. Covers the two
// behaviors most likely to regress quietly:
//   1. Renaming [Stage] thread_name in ~/.codex/session_index.jsonl
//   2. Archiving finished threads — drop index line AND move rollout file.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorkspace, runScript, readJsonl, writeJsonl, makeThreadRecord, seedCodexSession } from "./helpers.mjs";

test("renames thread_name with [Stage] prefix; idempotent across runs", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  const seeded = seedCodexSession(ws.home, { id: "019e0000-0000-7000-8000-000000000001", threadName: "old name" });
  const rec = makeThreadRecord({
    thread_id: "t1",
    title: "Test thread",
    display_title: "Outcome-framed title",
    stage: "Implement",
    sessions: [{ harness: "Codex", session_id: seeded.id, transcript_path: seeded.rolloutPath }],
  });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [rec]);

  runScript("apply-thread-names.mjs", ws.env);

  const indexPath = path.join(ws.home, ".codex", "session_index.jsonl");
  const after = readJsonl(indexPath);
  assert.equal(after.length, 1);
  assert.equal(after[0].thread_name, "[Implement] Outcome-framed title");

  // Second run is a no-op — script reports "renamed 0".
  const stdout = runScript("apply-thread-names.mjs", ws.env);
  assert.match(stdout, /renamed 0/);
  // Prefix doesn't compound.
  const after2 = readJsonl(indexPath);
  assert.equal(after2[0].thread_name, "[Implement] Outcome-framed title");
});

test("archives finished thread: drops index line, moves rollout to archived_sessions/", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  const seeded = seedCodexSession(ws.home, { id: "019e0000-0000-7000-8000-000000000002", threadName: "to archive" });
  const rec = makeThreadRecord({
    thread_id: "t2",
    title: "Finished thread",
    stage: "Done / Archive Candidates",
    manual_stage: "Done / Archive Candidates",
    manual_status: "done",
    manual_tracking: "archive",
    sessions: [{ harness: "Codex", session_id: seeded.id, transcript_path: seeded.rolloutPath }],
  });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [rec]);

  runScript("apply-thread-names.mjs", ws.env);

  // Index line is gone.
  const after = readJsonl(path.join(ws.home, ".codex", "session_index.jsonl"));
  assert.equal(after.length, 0, "archived session id should be removed from index");
  // Rollout moved.
  assert.equal(fs.existsSync(seeded.rolloutPath), false, "original rollout file should be gone");
  const archivedDir = path.join(ws.home, ".codex", "archived_sessions");
  const archived = fs.readdirSync(archivedDir);
  assert.equal(archived.length, 1, "rollout should land in archived_sessions/");
  assert.equal(archived[0], path.basename(seeded.rolloutPath));
});

test("auto-Done (manual_status not set) does NOT archive — heuristic Done is safe", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  const seeded = seedCodexSession(ws.home, { id: "019e0000-0000-7000-8000-000000000003", threadName: "auto done" });
  const rec = makeThreadRecord({
    thread_id: "t3",
    title: "Auto-promoted done",
    stage: "Done / Archive Candidates",       // inferred by git-aware promotion
    manual_stage: null,                       // user never explicitly finished
    manual_status: undefined,
    sessions: [{ harness: "Codex", session_id: seeded.id, transcript_path: seeded.rolloutPath }],
  });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [rec]);

  runScript("apply-thread-names.mjs", ws.env);

  // Index line is still there (renamed but not removed).
  const after = readJsonl(path.join(ws.home, ".codex", "session_index.jsonl"));
  assert.equal(after.length, 1, "auto-Done must not archive without explicit finish");
  assert.match(after[0].thread_name, /^\[Done\] /);
  // Rollout file untouched.
  assert.equal(fs.existsSync(seeded.rolloutPath), true);
});

test("cross-machine archive is a no-op for rollouts that don't exist locally", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  // A finished thread whose transcript path points at a different machine's
  // filesystem (the shared registry can carry these). On this machine the
  // rollout file does not exist and the session id is not in the local index.
  const rec = makeThreadRecord({
    thread_id: "t4",
    title: "Foreign machine",
    stage: "Done / Archive Candidates",
    manual_status: "done",
    sessions: [{
      harness: "Codex",
      session_id: "019e0000-0000-7000-8000-0000000000ff",
      transcript_path: "/Users/someone-else/.codex/sessions/2026/05/22/rollout-x.jsonl",
    }],
  });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [rec]);

  // Should not throw, should report 0 moved.
  const stdout = runScript("apply-thread-names.mjs", ws.env);
  assert.match(stdout, /moved 0 rollout/);
});
