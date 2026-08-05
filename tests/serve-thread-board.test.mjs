import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { makeWorkspace, runScript, writeJsonl, makeThreadRecord, SCRIPTS_DIR } from "./helpers.mjs";

test("server shows goal badges, goal filters, and draggable goal lifecycle board", async (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "content01",
      title: "Publish AI flow article",
      outcome_intent: "Buyers understand AI assisted delivery flow",
      intent_area: "Content & Publishing",
      stage: "Implement",
      where_it_stands: "Draft created and ready for review.",
      sessions: [{ session_id: "s1", resume: "codex resume s1", transcript_path: "" }],
    }),
    makeThreadRecord({
      thread_id: "skill001",
      title: "Add goal extraction",
      outcome_intent: "Agents can inspect work as goals",
      intent_area: "Skill Library & Agent Infra",
      stage: "Plan",
      where_it_stands: "Planning the implementation.",
      sessions: [{ session_id: "s2", resume: "codex resume s2", transcript_path: "" }],
    }),
  ]);
  runScript("extract-goal-network.mjs", ws.env);

  const port = await startServer(t, ws.env);

  const kanban = await fetchText(`http://127.0.0.1:${port}/kanban`);
  assert.match(kanban, /Agents can improve Content &amp; Publishing/);
  assert.match(kanban, /All goals/);

  const filtered = await fetchText(`http://127.0.0.1:${port}/kanban?goal=content-publishing`);
  assert.match(filtered, /Publish AI flow article/);
  assert.doesNotMatch(filtered, /Add goal extraction/);

  const goals = await fetchText(`http://127.0.0.1:${port}/goals`);
  assert.match(goals, /Considering \/ Exploring/);
  assert.match(goals, /Content &amp; Publishing outcomes/);
  assert.match(goals, /threads/);

  const buckets = await fetchText(`http://127.0.0.1:${port}/goal-threads`);
  assert.match(buckets, /AI Goal Thread Buckets/);
  assert.match(buckets, /goal-explorer-sidebar/);
  assert.match(buckets, /goal-explorer-detail/);
  assert.match(buckets, /data-goal-id="content-publishing"/);
  assert.match(buckets, /data-goal-id="skill-library-agent-infra"/);
  assert.match(buckets, /Publish AI flow article/);

  const createParams = new URLSearchParams({
    title: "New Market Signal",
    area: "Market Signals",
    outcome: "Yuval can decide whether this new signal deserves a committed goal.",
  });
  const createRes = await fetch(`http://127.0.0.1:${port}/create-goal?${createParams}`, { redirect: "manual" });
  assert.equal(createRes.status, 303);
  assert.match(createRes.headers.get("location") || "", /goal=new-market-signal/);

  let overrides = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-overrides.json"), "utf8"));
  let network;
  assert.equal(overrides.goals["new-market-signal"].title, "New Market Signal");

  const createdGoalPage = await fetchText(`http://127.0.0.1:${port}/goal-threads?goal=new-market-signal`);
  assert.match(createdGoalPage, /New Market Signal/);
  assert.match(createdGoalPage, /goal-edit-form/);
  assert.match(createdGoalPage, /0<\/span>/);

  const updateParams = new URLSearchParams({
    id: "new-market-signal",
    title: "Renamed Market Signal",
    area: "Market Learning",
    outcome: "Yuval can decide whether the renamed signal deserves a committed goal.",
  });
  const updateRes = await fetch(`http://127.0.0.1:${port}/update-goal?${updateParams}`, { redirect: "manual" });
  assert.equal(updateRes.status, 303);
  overrides = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-overrides.json"), "utf8"));
  assert.equal(overrides.goals["new-market-signal"].title, "Renamed Market Signal");
  assert.equal(overrides.goals["new-market-signal"].area, "Market Learning");
  assert.equal(overrides.goals["new-market-signal"].outcome_statement, "Yuval can decide whether the renamed signal deserves a committed goal.");
  network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.equal(network.goals.find((goal) => goal.id === "new-market-signal").title, "Renamed Market Signal");

  const moveParams = new URLSearchParams({ id: "content01", goal: "skill-library-agent-infra" });
  const moveRes = await fetch(`http://127.0.0.1:${port}/set-thread-goal?${moveParams}`);
  assert.equal(moveRes.status, 200);

  overrides = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-overrides.json"), "utf8"));
  assert.equal(overrides.thread_overrides.content01.goal_id, "skill-library-agent-infra");
  assert.match(overrides.thread_overrides.content01.rationale, /goal-bucket board/);

  network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.ok(network.goals.find((goal) => goal.id === "skill-library-agent-infra").supporting_threads.some((thread) => thread.thread_id === "content01"));
  assert.equal(network.goals.find((goal) => goal.id === "content-publishing"), undefined);

  const params = new URLSearchParams({ id: "content-publishing", stage: "In Progress" });
  const res = await fetch(`http://127.0.0.1:${port}/set-goal-stage?${params}`);
  assert.equal(res.status, 404);

  const stageParams = new URLSearchParams({ id: "skill-library-agent-infra", stage: "In Progress" });
  const stageRes = await fetch(`http://127.0.0.1:${port}/set-goal-stage?${stageParams}`);
  assert.equal(stageRes.status, 200);

  overrides = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-overrides.json"), "utf8"));
  assert.equal(overrides.goals["skill-library-agent-infra"].lifecycle_stage, "In Progress");

  network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.equal(network.goals.find((goal) => goal.id === "skill-library-agent-infra").lifecycle_stage, "In Progress");
});

async function startServer(t, env) {
  const port = 22000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, "serve-thread-board.mjs"), "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  const startedAt = Date.now();
  while (!output.includes(`http://127.0.0.1:${port}`)) {
    if (child.exitCode != null) throw new Error(`server exited early:\n${output}`);
    if (Date.now() - startedAt > 3000) throw new Error(`server did not start:\n${output}`);
    await sleep(25);
  }
  return port;
}

async function fetchText(url) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < 3000) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(25);
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
