import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorkspace, runScript, writeJsonl, makeThreadRecord } from "./helpers.mjs";

test("extracts goal-network JSON and Markdown from active thread registry", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "skill001",
      title: "Add goal extraction to thread board",
      outcome_intent: "Agents can inspect AI thread history as a goal network",
      intent_area: "Skill Library & Agent Infra",
      stage: "Implement",
      status: "active",
      where_it_stands: "Implementation in progress with tests added.",
      notes: "Need deterministic artifact before UI.",
      next_step: "Implement the extractor.",
      sessions: [{ session_id: "s1", resume: "codex resume s1", transcript_path: "/tmp/s1.jsonl" }],
    }),
    makeThreadRecord({
      thread_id: "skill002",
      title: "Ship cross harness resume prompts",
      outcome_intent: "Agents can resume work from goal context without rereading entire transcripts",
      intent_area: "Skill Library & Agent Infra",
      stage: "Review / Ship",
      status: "done",
      where_it_stands: "Tests passed and commit pushed.",
      sessions: [{ session_id: "s2", resume: "codex resume s2", transcript_path: "/tmp/s2.jsonl" }],
    }),
    makeThreadRecord({
      thread_id: "content01",
      title: "Publish AI flow article",
      outcome_intent: "Buyers understand how AI assisted delivery changes flow management",
      intent_area: "Content & Publishing",
      stage: "Plan",
      status: "active",
      where_it_stands: "Low evidence this is a thread worth tracking yet.",
      sessions: [{ session_id: "s3", resume: "codex resume s3", transcript_path: "/tmp/s3.jsonl" }],
    }),
  ]);

  const stdout = runScript("extract-goal-network.mjs", ws.env);
  assert.match(stdout, /Extracted 2 goals from 3 threads/);

  const jsonPath = path.join(ws.registry, "goal-network.json");
  const mdPath = path.join(ws.registry, "goal-network.md");
  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(mdPath), true);

  const network = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(network.schema_version, 1);
  assert.equal(network.thread_count, 3);
  assert.equal(network.goals.length, 2);

  const infra = network.goals.find((g) => g.id === "skill-library-agent-infra");
  assert.ok(infra);
  assert.equal(infra.supporting_threads.length, 2);
  assert.equal(infra.activity_evidence.length, 1);
  assert.equal(infra.traction_evidence.length, 1);
  assert.match(infra.resume_prompt, /^\/goal Drive toward:/);
  assert.match(infra.resume_prompt, /skill001/);
  assert.match(infra.resume_prompt, /skill002/);

  const content = network.goals.find((g) => g.id === "content-publishing");
  assert.ok(content);
  assert.equal(content.traction_evidence.length, 0, "low evidence should not count as traction evidence");
  assert.equal(content.activity_evidence.length, 1);

  const markdown = fs.readFileSync(mdPath, "utf8");
  assert.match(markdown, /# Goal Network/);
  assert.match(markdown, /## Agents can improve Skill Library & Agent Infra outcomes/);
  assert.match(markdown, /Traction evidence/);
  assert.match(markdown, /Activity evidence/);
});

test("omits done and archived threads unless requested", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "active001",
      title: "Active CRM cleanup",
      outcome_intent: "Pipeline owner can trust CRM segments",
      intent_area: "CRM & Pipeline Data",
      stage: "Implement",
      status: "active",
    }),
    makeThreadRecord({
      thread_id: "done001",
      title: "Finished CRM import",
      outcome_intent: "Pipeline owner can trust CRM imports",
      intent_area: "CRM & Pipeline Data",
      stage: "Done / Archive Candidates",
      status: "done",
      tracking_decision: "archive",
    }),
  ]);

  runScript("extract-goal-network.mjs", ws.env);
  let network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.equal(network.thread_count, 1);
  assert.equal(network.goals[0].supporting_threads.length, 1);

  runScript("extract-goal-network.mjs", ws.env, ["--include-done"]);
  network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.equal(network.thread_count, 2);
  assert.equal(network.goals[0].supporting_threads.length, 2);
});
