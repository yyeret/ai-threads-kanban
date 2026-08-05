import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeWorkspace, runScript, writeJsonl, makeThreadRecord } from "./helpers.mjs";

test("reviews goal progress and stamps goal network state", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "infra001",
      title: "Improve goal loop",
      outcome_intent: "Agents can review progress against goals weekly",
      intent_area: "Skill Library & Agent Infra",
      where_it_stands: "Implementation in progress with tests added.",
      next_step: "Run one review cycle.",
    }),
    makeThreadRecord({
      thread_id: "infra002",
      title: "Publish dashboard",
      outcome_intent: "Yuval can inspect goal progress",
      intent_area: "Skill Library & Agent Infra",
      where_it_stands: "Tests passed and review report created.",
      next_step: "Review the generated report.",
    }),
    makeThreadRecord({
      thread_id: "sales001",
      title: "Blocked proposal follow-up",
      outcome_intent: "Yuval can advance proposal follow-up",
      intent_area: "Sales & Proposals",
      blocked: true,
      where_it_stands: "Waiting on source material from the client.",
    }),
    makeThreadRecord({
      thread_id: "content001",
      title: "Draft article",
      outcome_intent: "Readers can understand the AI delivery shift",
      intent_area: "Content & Publishing",
      where_it_stands: "Outline drafted.",
    }),
  ]);

  fs.writeFileSync(path.join(ws.registry, "goal-overrides.json"), JSON.stringify({
    schema_version: 1,
    goals: {
      "skill-library-agent-infra": {
        leading_indicators: ["At least one weekly review report is generated."],
      },
    },
  }, null, 2), "utf8");

  runScript("extract-goal-network.mjs", ws.env);
  const stdout = runScript("review-goal-progress.mjs", ws.env);
  assert.match(stdout, /Reviewed 3 goals/);

  const statePath = path.join(ws.registry, "goal-review-state.json");
  const reportPath = path.join(ws.registry, "goal-review.md");
  const historyPath = path.join(ws.registry, "goal-review-history.jsonl");
  assert.equal(fs.existsSync(statePath), true);
  assert.equal(fs.existsSync(reportPath), true);
  assert.equal(fs.existsSync(historyPath), true);

  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.summary.total, 3);
  assert.equal(state.summary.blocked, 1);
  assert.equal(state.summary.no_progress, 1);
  assert.equal(state.summary.unobservable, 0);

  const infra = state.goals.find((goal) => goal.id === "skill-library-agent-infra");
  assert.ok(infra);
  assert.equal(infra.status, "progressing");
  assert.equal(infra.metrics.traction_evidence, 1);
  assert.ok(infra.indicators.length >= 1);
  assert.equal(infra.intent_canvas_ref, "docs/goal-intents/skill-library-agent-infra.md");
  assert.equal(infra.association_review.counts.total, 2);
  assert.ok(infra.association_review.counts.strong_fit >= 1);

  const sales = state.goals.find((goal) => goal.id === "sales-proposals");
  assert.ok(sales);
  assert.equal(sales.status, "blocked");
  assert.equal(sales.next_best_action.kind, "unblock");

  const reviewedNetwork = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  const stamped = reviewedNetwork.goals.find((goal) => goal.id === "skill-library-agent-infra");
  assert.equal(stamped.weekly_review.status, "progressing");

  const report = fs.readFileSync(reportPath, "utf8");
  assert.match(report, /# Goal Progress Review/);
  assert.match(report, /Next best action/);
  assert.match(report, /Thread fit:/);
});
