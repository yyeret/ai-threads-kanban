// Regression tests for scripts/edit-thread.mjs. Covers the user-facing
// transitions that drive harness-side archive behavior, plus stage matching.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorkspace, runScript, readJsonl, writeJsonl, makeThreadRecord } from "./helpers.mjs";

test("--finish marks the thread Done + done + archive (the archive gate)", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  const rec = makeThreadRecord({
    thread_id: "f1aabbcc",
    title: "Ship the widget",
    stage: "Implement",
  });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [rec]);

  runScript("edit-thread.mjs", ws.env, ["--match", "ship the widget", "--finish"]);

  const out = readJsonl(path.join(ws.registry, "active-threads.jsonl"));
  assert.equal(out[0].manual_stage, "Done / Archive Candidates");
  assert.equal(out[0].manual_status, "done");
  assert.equal(out[0].manual_tracking, "archive");
});

test("--stage fuzzy-matches stage names (implement, review, done)", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  const rec = makeThreadRecord({ thread_id: "s1abcdef", title: "Stage test", stage: "Funnel / Triage" });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [rec]);

  runScript("edit-thread.mjs", ws.env, ["--match", "stage test", "--stage", "review"]);
  let out = readJsonl(path.join(ws.registry, "active-threads.jsonl"));
  assert.equal(out[0].manual_stage, "Review / Ship");

  runScript("edit-thread.mjs", ws.env, ["--match", "stage test", "--stage", "implement"]);
  out = readJsonl(path.join(ws.registry, "active-threads.jsonl"));
  assert.equal(out[0].manual_stage, "Implement");
});

test("--note '' clears the note (regression: parseArgs used to treat '' as missing)", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  const rec = makeThreadRecord({ thread_id: "n1abcdef", title: "Note test", notes: "old reason" });
  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [rec]);

  runScript("edit-thread.mjs", ws.env, ["--match", "note test", "--note"]);
  const out = readJsonl(path.join(ws.registry, "active-threads.jsonl"));
  assert.equal(out[0].notes, "");
});
