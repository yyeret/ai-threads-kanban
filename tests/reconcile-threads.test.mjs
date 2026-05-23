// Regression tests for scripts/reconcile-threads.mjs. The hot bug this
// session was that manual_status was being wiped on every rescan — the
// reconciler folded it into the derived `status` field but didn't preserve
// the raw manual_* fields. These tests lock that fix in place.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorkspace, runScript, readJsonl, writeJsonl, makeThreadRecord } from "./helpers.mjs";

test("reconcile preserves manual_status / manual_tracking / manual_area across rescans", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  // A prior registry with manual_* set, as if the user finished a thread.
  const prior = makeThreadRecord({
    thread_id: "deadbeef",
    title: "Already finished",
    manual_stage: "Done / Archive Candidates",
    manual_status: "done",
    manual_tracking: "archive",
    manual_area: "Custom Area",
    stage: "Done / Archive Candidates",
  });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [prior]);

  // A scan card that would otherwise infer Implement — same thread_id so it
  // matches the prior record. Without preservation, reconcile would wipe
  // manual_* and the next apply-thread-names would not archive.
  const scanCard = {
    thread_id: "deadbeef",
    intent_hash: "intent",
    repo_key: "repo",
    title: "Already finished",
    stage: "Implement",
    status: "active",
    tracking_decision: "track",
    where_it_stands: "Looks like there is more to do.",
    harness: "Codex",
    machine: "test-machine",
    session_id: "sess-1",
    cwd: "/tmp",
    transcript_path: "/tmp/missing.jsonl",
    resume: "codex resume sess-1",
    lastActivity: new Date().toISOString(),
    firstSeen: new Date().toISOString(),
    tool_count: 0,
  };
  writeJsonl(path.join(ws.registry, "threads.test-machine.jsonl"), [scanCard]);

  runScript("reconcile-threads.mjs", ws.env);

  const out = readJsonl(path.join(ws.registry, "active-threads.jsonl"));
  assert.equal(out.length, 1);
  const r = out[0];
  assert.equal(r.manual_status, "done", "manual_status must survive reconcile");
  assert.equal(r.manual_tracking, "archive", "manual_tracking must survive reconcile");
  assert.equal(r.manual_area, "Custom Area", "manual_area must survive reconcile");
  assert.equal(r.manual_stage, "Done / Archive Candidates");
  assert.equal(r.stage, "Done / Archive Candidates", "manual_stage wins over inferred stage");
});

test("reconcile heals unknown stages from legacy taxonomies", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  // A record from a pre-On-Hold taxonomy with a stage name we no longer recognize.
  const stale = makeThreadRecord({
    thread_id: "legacy01",
    title: "Legacy stage",
    stage: "Below Threshold",
    manual_stage: "Below Threshold",
  });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [stale]);
  // No scan card for it => goes through the dropped-thread loop, which heals legacy stages.
  writeJsonl(path.join(ws.registry, "threads.test-machine.jsonl"), []);

  runScript("reconcile-threads.mjs", ws.env);

  const out = readJsonl(path.join(ws.registry, "active-threads.jsonl"));
  assert.equal(out[0].stage, "Funnel / Triage");
  assert.equal(out[0].manual_stage, "Funnel / Triage");
});
