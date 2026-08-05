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
  assert.equal(infra.lifecycle_stage, "Considering / Exploring");
  assert.equal(infra.traction_status, "yellow");
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

test("includes manually defined goals before they have supporting threads", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "content01",
      title: "Publish AI flow article",
      outcome_intent: "Buyers understand AI assisted delivery flow",
      intent_area: "Content & Publishing",
      stage: "Implement",
      status: "active",
    }),
  ]);
  fs.writeFileSync(path.join(ws.registry, "goal-overrides.json"), JSON.stringify({
    schema_version: 1,
    goals: {
      "new-market-signal": {
        title: "Understand a new market signal",
        outcome_statement: "Yuval can decide whether this new signal deserves a committed goal.",
        area: "Market Signals",
      },
    },
  }, null, 2), "utf8");

  runScript("extract-goal-network.mjs", ws.env);
  const network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  const manual = network.goals.find((goal) => goal.id === "new-market-signal");
  assert.ok(manual);
  assert.equal(manual.supporting_threads.length, 0);
  assert.equal(manual.title, "Understand a new market signal");
});

test("folds reviewed thread overrides and stale goal definitions through goal aliases", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "old001",
      title: "Old content work",
      outcome_intent: "Readers can find the content",
      intent_area: "Other / Unsorted",
      stage: "Implement",
      status: "active",
    }),
  ]);
  fs.writeFileSync(path.join(ws.registry, "goal-overrides.json"), JSON.stringify({
    schema_version: 1,
    goals: {
      "content-publishing": {
        title: "Old content goal",
        area: "Content & Publishing",
      },
      "marketing-discoverability": {
        title: "Marketing and discoverability",
        outcome_statement: "Yuval is findable by the right buyers.",
        area: "Marketing",
      },
    },
    thread_overrides: {
      old001: { goal_id: "content-publishing", rationale: "Previously reviewed." },
    },
    goal_overrides: {
      "content-publishing": { goal_id: "marketing-discoverability" },
    },
  }, null, 2), "utf8");

  runScript("extract-goal-network.mjs", ws.env);
  const network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.equal(network.goals.some((goal) => goal.id === "content-publishing"), false);
  const master = network.goals.find((goal) => goal.id === "marketing-discoverability");
  assert.ok(master);
  assert.deepEqual(master.supporting_threads.map((thread) => thread.thread_id), ["old001"]);
});

test("uses session folder hints when deterministic area is too broad", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "crm001",
      title: "Clean up CRM contacts",
      outcome_intent: "Pipeline owner can trust follow-up segments",
      intent_area: "Other / Unsorted",
      stage: "Implement",
      status: "active",
      repo_key: "crm-ops",
      sessions: [{ session_id: "s1", cwd: "/Users/yuval/Agility/Work ON the Business/CRM Ops", resume: "codex resume s1" }],
    }),
    makeThreadRecord({
      thread_id: "sitecontent001",
      title: "Refresh AI visibility article",
      outcome_intent: "Readers can find the AI transformation insight",
      intent_area: "Other / Unsorted",
      stage: "Implement",
      status: "active",
      repo_key: "yeret-agility-site",
      sessions: [{ session_id: "s2", cwd: "/Users/yuval/Github/yeret-agility-site", resume: "codex resume s2" }],
    }),
  ]);
  fs.writeFileSync(path.join(ws.registry, "goal-overrides.json"), JSON.stringify({
    schema_version: 1,
    goals: {
      "revenue-pipeline-outreach": {
        title: "Revenue Pipeline & Outreach",
        outcome_statement: "Yuval can advance sales pipeline work.",
        area: "Revenue Pipeline & Outreach",
      },
      "marketing-discoverability": {
        title: "Marketing and Discoverability",
        outcome_statement: "The right buyers can find Yuval.",
        area: "Marketing",
      },
      "website-developer": {
        title: "Website Developer",
        outcome_statement: "The website works reliably.",
        area: "Website",
      },
    },
  }, null, 2), "utf8");

  runScript("extract-goal-network.mjs", ws.env);
  const network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.ok(network.goals.find((goal) => goal.id === "revenue-pipeline-outreach").supporting_threads.some((thread) => thread.thread_id === "crm001"));
  assert.ok(network.goals.find((goal) => goal.id === "marketing-discoverability").supporting_threads.some((thread) => thread.thread_id === "sitecontent001"));
  assert.equal(network.goals.find((goal) => goal.id === "website-developer").supporting_threads.length, 0);
});

test("routes C-SDD and AI-native site content away from website developer", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "safe001",
      title: "Customizing SAFe for the reality of spec-driven AI development",
      outcome_intent: "Leaders can adapt delivery systems for AI-native work.",
      intent_area: "Other / Unsorted",
      stage: "Implement",
      status: "active",
      repo_key: "ai-skill-library",
      sessions: [{ session_id: "s1", cwd: "/Users/yuval/Github/ai-skill-library", resume: "codex resume s1" }],
    }),
    makeThreadRecord({
      thread_id: "csdd001",
      title: "I look at the whole spec-driven thing differently",
      outcome_intent: "C-SDD content draft for AI-native delivery systems.",
      intent_area: "Other / Unsorted",
      stage: "Implement",
      status: "active",
      repo_key: "yeret-agility-site",
      sessions: [{ session_id: "s2", cwd: "/Users/yuval/Github/yeret-agility-site", resume: "codex resume s2" }],
    }),
    makeThreadRecord({
      thread_id: "web001",
      title: "Fix website navigation behavior",
      outcome_intent: "The website menu opens reliably on mobile.",
      intent_area: "Other / Unsorted",
      stage: "Implement",
      status: "active",
      repo_key: "yeret-agility-site",
      sessions: [{ session_id: "s3", cwd: "/Users/yuval/Github/yeret-agility-site", resume: "codex resume s3" }],
    }),
  ]);
  fs.writeFileSync(path.join(ws.registry, "goal-overrides.json"), JSON.stringify({
    schema_version: 1,
    goals: {
      "ai-native-delivery-systems": {
        title: "AI-Native Delivery Systems",
        outcome_statement: "Leaders can adapt delivery systems for AI-native work.",
        area: "AI-Native Delivery Systems",
      },
      "website-developer": {
        title: "Website Developer",
        outcome_statement: "The website works reliably.",
        area: "Website",
      },
    },
  }, null, 2), "utf8");

  runScript("extract-goal-network.mjs", ws.env);
  const network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.deepEqual(
    network.goals.find((goal) => goal.id === "ai-native-delivery-systems").supporting_threads.map((thread) => thread.thread_id).sort(),
    ["csdd001", "safe001"],
  );
  assert.deepEqual(
    network.goals.find((goal) => goal.id === "website-developer").supporting_threads.map((thread) => thread.thread_id),
    ["web001"],
  );
});

test("applies reviewed goal overrides without mutating source thread registry", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "other001",
      title: "Assess backlink strength",
      outcome_intent: "What is our backlink strength and should we improve it?",
      intent_area: "Other / Unsorted",
      stage: "Specify",
      status: "specifying",
    }),
    makeThreadRecord({
      thread_id: "other002",
      title: "What can we learn from GSC AI visibility",
      outcome_intent: "Yuval can decide which AI visibility signals matter from Search Console data",
      intent_area: "Other / Unsorted",
      stage: "Specify",
      status: "specifying",
    }),
    makeThreadRecord({
      thread_id: "noise001",
      title: "/model",
      outcome_intent: "/model",
      intent_area: "Other / Unsorted",
      stage: "Funnel / Triage",
      status: "triage",
    }),
    makeThreadRecord({
      thread_id: "site001",
      title: "Improve quick chat copy",
      outcome_intent: "Visitors can book a casual conversation without feeling sold to",
      intent_area: "Site & Web",
      stage: "Implement",
      status: "active",
    }),
  ]);

  fs.writeFileSync(path.join(ws.registry, "goal-overrides.json"), JSON.stringify({
    schema_version: 1,
    goals: {
      "search-visibility": {
        title: "Yuval can see which search and AI visibility work deserves attention",
        outcome_statement: "Yuval can decide which search and AI visibility opportunities are worth acting on next.",
        area: "Search & AI Visibility",
        lifecycle_stage: "Review / Adaptation",
        traction_status: "green",
        intent_canvas_ref: "docs/goal-intents/search-visibility.md",
        key_results: ["Two search opportunities are either acted on or explicitly rejected."],
        leading_indicators: ["Search-related threads have reviewed goal assignments."],
        fit_signals: ["search", "visibility", "backlink", "gsc"],
        anti_fit_signals: ["crm", "proposal"],
        straying_questions: ["Is this still search visibility work or a broader marketing goal?"],
      },
      "website-conversion": {
        title: "Visitors can take the right next step from the website",
        outcome_statement: "Visitors can understand the next conversation option and take it without sales pressure.",
      },
    },
    thread_overrides: {
      other001: { goal_id: "search-visibility", rationale: "Backlink strength is search visibility work." },
      other002: { goal_id: "search-visibility", rationale: "GSC AI visibility belongs with search visibility." },
      noise001: { suppress: true, rationale: "Slash command noise, not goal work." },
    },
    goal_overrides: {
      "site-web": { goal_id: "website-conversion" },
    },
  }, null, 2), "utf8");

  runScript("extract-goal-network.mjs", ws.env);

  const network = JSON.parse(fs.readFileSync(path.join(ws.registry, "goal-network.json"), "utf8"));
  assert.equal(network.thread_count, 3, "suppressed thread should not count");
  assert.equal(network.goals.some((g) => g.supporting_threads.some((thread) => thread.thread_id === "noise001")), false);

  const search = network.goals.find((g) => g.id === "search-visibility");
  assert.ok(search);
  assert.equal(search.title, "Yuval can see which search and AI visibility work deserves attention");
  assert.equal(search.lifecycle_stage, "Review / Adaptation");
  assert.equal(search.traction_status, "green");
  assert.equal(search.intent_canvas_ref, "docs/goal-intents/search-visibility.md");
  assert.deepEqual(search.fit_signals, ["search", "visibility", "backlink", "gsc"]);
  assert.deepEqual(search.anti_fit_signals, ["crm", "proposal"]);
  assert.deepEqual(search.straying_questions, ["Is this still search visibility work or a broader marketing goal?"]);
  assert.equal(search.supporting_threads.length, 2);
  assert.deepEqual(search.supporting_threads.map((thread) => thread.thread_id).sort(), ["other001", "other002"]);

  const website = network.goals.find((g) => g.id === "website-conversion");
  assert.ok(website);
  assert.equal(website.supporting_threads.length, 1);
  assert.equal(website.area, "Site & Web");
});
