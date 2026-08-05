#!/usr/bin/env node
// Fast local web board for the AI thread registry.
//   node serve-thread-board.mjs [--port 7878]
// Opens http://127.0.0.1:7878 — threads grouped by stage, filterable by intent
// area, with one click to continue a session in a terminal or review its log.
// Binds to localhost only.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync, execSync } from "node:child_process";
import { resolveRegistryDir } from "./lib/paths.mjs";

const home = os.homedir();
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || process.env.THREAD_BOARD_PORT || 7878);
const devMode = Boolean(args.dev || process.env.THREAD_BOARD_DEBUG || process.env.NODE_ENV === "development");
const dir = resolveRegistryDir();
const registryPath = path.join(dir, "active-threads.jsonl");
const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repoRoot = path.resolve(scriptDir, "..");

// Kanban lanes, left to right. Funnel/Triage is the muted holding lane for
// already-started threads not yet clearly worth tracking; Done is muted at the
// far right; the middle is the committed Specify -> Review flow.
const STAGE_ORDER = [
  "Funnel / Triage", "On Hold", "Specify", "Plan", "Implement", "Review / Ship",
  "Done / Archive Candidates",
];
const LIST_ORDER = STAGE_ORDER;
const MUTED_STAGES = new Set(["Funnel / Triage", "On Hold", "Done / Archive Candidates"]);
const GOAL_STAGE_ORDER = [
  "Considering / Exploring",
  "Planning / Committing",
  "In Progress",
  "Review / Adaptation",
  "Done",
];
const MUTED_GOAL_STAGES = new Set(["Considering / Exploring", "Done"]);
const goalNetworkPath = path.join(dir, "goal-network.json");
const goalOverridesPath = path.join(dir, "goal-overrides.json");

// In-memory registry cache — loaded async at startup and on /refresh so
// request handlers never block on a Drive readFileSync that can stall
// indefinitely in a launchd (non-GUI) session.
let _registryCache = [];
const indexPath = path.join(dir, "search-index.json");
let _searchIndex = {};
let _indexingInProgress = false;
let _goalNetworkCache = null;
let _goalByThreadId = new Map();

async function rebuildSearchIndex() {
  if (_indexingInProgress) return;
  _indexingInProgress = true;
  if (devMode) console.log("[search] starting search index build...");
  try {
    let index = {};
    if (fs.existsSync(indexPath)) {
      try {
        const indexText = await fs.promises.readFile(indexPath, "utf8");
        index = JSON.parse(indexText);
      } catch (err) {
        if (devMode) console.error(`[search] failed to read index file: ${err.message}`);
      }
    }

    let updated = false;
    for (const thread of _registryCache) {
      const threadId = thread.thread_id;
      const s0 = (thread.sessions || [])[0];
      const transcriptPath = s0?.transcript_path;

      if (transcriptPath && fs.existsSync(transcriptPath)) {
        try {
          const stat = await fs.promises.stat(transcriptPath);
          const mtime = stat.mtimeMs;
          const size = stat.size;

          const cached = index[threadId];
          if (cached && cached.mtime === mtime && cached.size === size) {
            continue;
          }

          if (devMode) console.log(`[search] indexing transcript: ${transcriptPath}`);
          const messages = readTranscript(transcriptPath);
          const transcriptText = messages.map(m => m.text).join(" ").toLowerCase();

          index[threadId] = {
            mtime,
            size,
            transcriptText,
          };
          updated = true;
        } catch (err) {
          if (devMode) console.error(`[search] failed to index ${transcriptPath}: ${err.message}`);
        }
      } else {
        if (index[threadId]) {
          delete index[threadId];
          updated = true;
        }
      }
    }

    _searchIndex = index;
    if (updated) {
      await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
      if (devMode) console.log(`[search] index updated and saved.`);
    } else {
      if (devMode) console.log(`[search] index is already up to date.`);
    }
  } catch (err) {
    if (devMode) console.error(`[search] indexing error: ${err.message}`);
  } finally {
    _indexingInProgress = false;
  }
}

async function reloadRegistryCache() {
  try {
    const text = await fs.promises.readFile(registryPath, "utf8");
    _registryCache = text.split(/\r?\n/).filter((l) => l.trim())
      .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
      .sort((a, b) => Date.parse(b.last_activity || 0) - Date.parse(a.last_activity || 0));
    if (devMode) console.log(`[cache] loaded ${_registryCache.length} threads`);
    
    // Trigger indexing in the background asynchronously
    rebuildSearchIndex();
  } catch (err) {
    if (devMode) console.error(`[cache] load failed: ${err.message}`);
  }
}
async function reloadGoalNetworkCache() {
  try {
    const text = await fs.promises.readFile(goalNetworkPath, "utf8");
    const network = JSON.parse(text);
    const byThread = new Map();
    for (const goal of network.goals || []) {
      for (const thread of goal.supporting_threads || []) {
        if (thread.thread_id) byThread.set(thread.thread_id, goal);
      }
    }
    _goalNetworkCache = network;
    _goalByThreadId = byThread;
    if (devMode) console.log(`[goals] loaded ${network.goals?.length || 0} goals`);
  } catch (err) {
    _goalNetworkCache = null;
    _goalByThreadId = new Map();
    if (devMode) console.error(`[goals] load failed: ${err.message}`);
  }
}
reloadRegistryCache(); // warm the cache and run indexer on startup; non-blocking
reloadGoalNetworkCache(); // warm goal badges/filters if the extractor has run

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/") return sendHtml(res, renderBoard(url.searchParams));
    if (url.pathname === "/kanban") return sendHtml(res, renderKanban(url.searchParams));
    if (url.pathname === "/goals") return sendHtml(res, renderGoalsKanban(url.searchParams));
    if (url.pathname === "/goal-threads") return sendHtml(res, renderGoalThreadBuckets(url.searchParams));
    if (url.pathname === "/telemetry") return sendHtml(res, renderTelemetry(url.searchParams));
    if (url.pathname === "/kanban-ipsum") return sendHtml(res, renderKanban(null, true));
    if (url.pathname === "/continue") return handleContinue(res, url.searchParams.get("id"), url.searchParams.get("step"));
    if (url.pathname === "/log") return handleLog(res, url.searchParams.get("id"));
    if (url.pathname === "/card") return handleCard(res, url.searchParams.get("id"));
    if (url.pathname === "/refresh") return handleRefresh(res, url.searchParams);
    if (url.pathname === "/set-stage") return handleSetStage(res, url.searchParams.get("id"), url.searchParams.get("stage"));
    if (url.pathname === "/set-goal-stage") return handleSetGoalStage(res, url.searchParams.get("id"), url.searchParams.get("stage"));
    if (url.pathname === "/set-thread-goal") return handleSetThreadGoal(res, url.searchParams.get("id"), url.searchParams.get("goal"));
    if (url.pathname === "/create-goal") return handleCreateGoal(res, url.searchParams);
    if (url.pathname === "/update-goal") return handleUpdateGoal(res, url.searchParams);
    res.writeHead(404).end("Not found");
  } catch (err) {
    res.writeHead(500).end(`Error: ${err.message}`);
  }
});

server.listen(port, "127.0.0.1", () => {
  const repoRoot = path.join(scriptDir, "..");
  logServerVersion(dir, os.hostname(), repoRoot);
  console.log(`AI thread board: http://127.0.0.1:${port}`);
});

// --- routes ----------------------------------------------------------------

function handleContinue(res, id, withStep) {
  const t = findThread(id);
  if (!t) return res.writeHead(404).end("Thread not found");
  const session = (t.sessions || [])[0];
  if (!session || !session.resume) return res.writeHead(400).end("No resume command for this thread");
  const ok = openTerminal(session.cwd || home, session.resume);
  // "Continue with next action" also puts the suggested step on the clipboard.
  if (withStep && t.next_step) copyToClipboard(t.next_step);
  if (devMode) {
    console.log(`[continue] ${ok ? "opened" : "failed"} id=${id} cwd=${session.cwd || home} command=${session.resume}`);
  }
  res.writeHead(303, { Location: "/" }).end(ok ? "" : "Could not open a terminal");
}

function copyToClipboard(text) {
  try {
    const p = process.platform === "darwin"
      ? spawn("pbcopy", { stdio: ["pipe", "ignore", "ignore"] })
      : spawn("clip", { stdio: ["pipe", "ignore", "ignore"] });
    p.stdin.write(text);
    p.stdin.end();
    return true;
  } catch {
    return false;
  }
}

function handleCard(res, id) {
  const t = findThread(id);
  if (!t) return res.writeHead(404).end("Thread not found");
  sendHtml(res, renderCard(t));
}

function handleLog(res, id) {
  const t = findThread(id);
  if (!t) return res.writeHead(404).end("Thread not found");
  const session = (t.sessions || [])[0];
  if (!session || !session.transcript_path || !fs.existsSync(session.transcript_path)) {
    return sendHtml(res, `<p>No transcript on disk for this thread.</p><p><a href="/">&larr; board</a></p>`);
  }
  sendHtml(res, renderLog(t, session));
}

function handleSetStage(res, id, stage) {
  if (!id || !stage || !STAGE_ORDER.includes(stage)) {
    return res.writeHead(400).end("bad request");
  }
  const records = loadRegistry();
  const t = records.find((r) => r.thread_id === id);
  if (!t) return res.writeHead(404).end("thread not found");
  t.manual_stage = stage;
  t.stage = stage;
  // Moving a thread is a touch — reset the idle clock from now.
  t.stage_changed_at = new Date().toISOString();
  t.updated_at = t.stage_changed_at;
  // Mirror edit-thread.mjs --finish: dropping a card onto Done marks it
  // finished, which is the gate apply-thread-names uses to archive the
  // Codex rollout. Moving away from Done clears that flag so it isn't
  // archived on the next refresh.
  if (stage === "Done / Archive Candidates") {
    t.manual_status = "done";
    t.manual_tracking = "archive";
  } else if (t.manual_status === "done") {
    delete t.manual_status;
    if (t.manual_tracking === "archive") delete t.manual_tracking;
  }
  fs.writeFileSync(registryPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  // Re-render the board and re-stamp harness session names with the new stage.
  try {
    execFileSync(process.execPath, [path.join(scriptDir, "reconcile-threads.mjs")], { stdio: "ignore" });
    execFileSync(process.execPath, [path.join(scriptDir, "apply-thread-names.mjs")], { stdio: "ignore" });
  } catch {
    /* registry write already succeeded; board still reflects the change */
  }
  reloadRegistryCache(); // async, non-blocking
  res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
}

function handleSetGoalStage(res, id, stage) {
  if (!id || !stage || !GOAL_STAGE_ORDER.includes(stage)) {
    return res.writeHead(400).end("bad request");
  }
  const goal = findGoal(id);
  if (!goal) return res.writeHead(404).end("goal not found");

  const overrides = loadGoalOverrides();
  overrides.goals[id] = {
    ...(overrides.goals[id] || {}),
    title: overrides.goals[id]?.title || goal.title,
    outcome_statement: overrides.goals[id]?.outcome_statement || goal.outcome_statement,
    area: overrides.goals[id]?.area || goal.area,
    lifecycle_stage: stage,
    updated_at: new Date().toISOString(),
  };
  saveGoalOverrides(overrides);
  rebuildGoalNetworkSync();
  reloadGoalNetworkCache(); // async, non-blocking
  res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
}

function handleSetThreadGoal(res, id, goalId) {
  if (!id || !goalId) return res.writeHead(400).end("bad request");
  const thread = findThread(id);
  if (!thread) return res.writeHead(404).end("thread not found");
  const goal = findGoal(goalId);
  if (!goal) return res.writeHead(404).end("goal not found");

  const previousGoal = goalForThread(id);
  if (previousGoal?.id === goal.id) {
    return res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
  }

  const overrides = loadGoalOverrides();
  overrides.thread_overrides[id] = {
    ...(overrides.thread_overrides[id] || {}),
    goal_id: goal.id,
    suppress: false,
    rationale: `Reviewed in the goal-bucket board: moved from ${previousGoal?.id || "unassigned"} to ${goal.id}.`,
    updated_at: new Date().toISOString(),
  };
  saveGoalOverrides(overrides);
  rebuildGoalNetworkSync();
  reloadGoalNetworkCache(); // async, non-blocking
  res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
}

function handleCreateGoal(res, searchParams) {
  const title = String(searchParams.get("title") || "").trim();
  if (!title) return res.writeHead(400).end("goal title required");
  const area = String(searchParams.get("area") || "").trim() || "Manual Goals";
  const outcome = String(searchParams.get("outcome") || "").trim()
    || `Yuval can make intentional progress on ${title}.`;
  const overrides = loadGoalOverrides();
  const id = uniqueGoalId(slugifyGoalId(title), overrides);
  overrides.goals[id] = {
    title,
    outcome_statement: outcome,
    area,
    lifecycle_stage: "Considering / Exploring",
    traction_status: "red",
    key_results: [],
    leading_indicators: [],
    fit_signals: [],
    anti_fit_signals: [],
    straying_questions: ["Does this thread expose a new committed goal or a temporary diversion?"],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    manual: true,
  };
  saveGoalOverrides(overrides);
  rebuildGoalNetworkSync();
  reloadGoalNetworkCache(); // async, non-blocking
  res.writeHead(303, { Location: queryPath("/goal-threads", { goal: id }) }).end();
}

function handleUpdateGoal(res, searchParams) {
  const id = String(searchParams.get("id") || "").trim();
  const goal = findGoal(id);
  if (!id || !goal) return res.writeHead(404).end("goal not found");
  const title = String(searchParams.get("title") || "").trim();
  const area = String(searchParams.get("area") || "").trim();
  const outcome = String(searchParams.get("outcome") || "").trim();
  if (!title || !outcome) return res.writeHead(400).end("goal title and outcome required");

  const overrides = loadGoalOverrides();
  const previous = overrides.goals[id] || {};
  overrides.goals[id] = {
    ...previous,
    title,
    outcome_statement: outcome,
    area: area || goal.area || "Manual Goals",
    lifecycle_stage: previous.lifecycle_stage || goal.lifecycle_stage || "Considering / Exploring",
    traction_status: previous.traction_status || goal.traction_status || "red",
    key_results: Array.isArray(previous.key_results) ? previous.key_results : (Array.isArray(goal.key_results) ? goal.key_results : []),
    leading_indicators: Array.isArray(previous.leading_indicators) ? previous.leading_indicators : (Array.isArray(goal.leading_indicators) ? goal.leading_indicators : []),
    fit_signals: Array.isArray(previous.fit_signals) ? previous.fit_signals : (Array.isArray(goal.fit_signals) ? goal.fit_signals : []),
    anti_fit_signals: Array.isArray(previous.anti_fit_signals) ? previous.anti_fit_signals : (Array.isArray(goal.anti_fit_signals) ? goal.anti_fit_signals : []),
    straying_questions: Array.isArray(previous.straying_questions) ? previous.straying_questions : (Array.isArray(goal.straying_questions) ? goal.straying_questions : []),
    updated_at: new Date().toISOString(),
  };
  saveGoalOverrides(overrides);
  rebuildGoalNetworkSync();
  reloadGoalNetworkCache(); // async, non-blocking
  res.writeHead(303, { Location: queryPath("/goal-threads", { goal: id }) }).end();
}

function handleRefresh(res, searchParams) {
  let gitUpdated = false;
  const repoRoot = path.join(scriptDir, "..");
  
  // Check Git self-updates
  try {
    const isGit = fs.existsSync(path.join(repoRoot, ".git"));
    if (isGit) {
      const beforeHead = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
      execSync("git pull", { cwd: repoRoot, stdio: "ignore" });
      const afterHead = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
      if (beforeHead !== afterHead) {
        gitUpdated = true;
        if (devMode) console.log(`[git] updated from ${beforeHead} to ${afterHead}`);
        // Run npm install if package.json changed
        try {
          const changedFiles = execSync(`git diff --name-only ${beforeHead} ${afterHead}`, { cwd: repoRoot, encoding: "utf8" })
            .split(/\r?\n/);
          if (changedFiles.includes("package.json")) {
            if (devMode) console.log("[git] package.json changed, running npm install...");
            execSync("npm install", { cwd: repoRoot, stdio: "ignore" });
          }
        } catch (err) {
          if (devMode) console.error(`[git] npm install failed: ${err.message}`);
        }
      }
    }
  } catch (err) {
    if (devMode) console.error(`[git] update failed: ${err.message}`);
  }

  // Scan + reconcile only make sense when the process can reach the primary
  // registry (Drive). When running as a launchd agent the primary is
  // inaccessible; the local mirror is kept current by stop-hook refreshes.
  // We still try — if it fails the cached data stays valid.
  try {
    execFileSync(process.execPath, [path.join(scriptDir, "scan-session-history.mjs"), "--days", "30"], { stdio: "ignore" });
    execFileSync(process.execPath, [path.join(scriptDir, "reconcile-threads.mjs")], { stdio: "ignore" });
    execFileSync(process.execPath, [path.join(scriptDir, "extract-goal-network.mjs")], { stdio: "ignore" });
    execFileSync(process.execPath, [path.join(scriptDir, "review-goal-progress.mjs")], { stdio: "ignore" });
  } catch {
    /* ignore — board still serves the last good registry */
  }
  reloadRegistryCache(); // async, non-blocking
  reloadGoalNetworkCache(); // async, non-blocking
  
  const params = {};
  if (searchParams) {
    if (searchParams.get("area")) params.area = searchParams.get("area");
    if (searchParams.get("goal")) params.goal = searchParams.get("goal");
    if (searchParams.get("harness")) params.harness = searchParams.get("harness");
    if (searchParams.get("machine")) params.machine = searchParams.get("machine");
    if (searchParams.get("q")) params.q = searchParams.get("q");
  }
  const from = searchParams?.get("from") || "/";
  const redirectUrl = queryPath(from, params);
  res.writeHead(303, { Location: redirectUrl }).end();

  // Gracefully exit to trigger process manager restart if git was updated
  if (gitUpdated) {
    if (devMode) console.log("[git] exiting to restart server...");
    setTimeout(() => {
      process.exit(0);
    }, 500);
  }
}

// --- terminal launch -------------------------------------------------------

function openTerminal(cwd, command) {
  const useDir = cwd && fs.existsSync(cwd) ? cwd : home;
  if (process.platform === "darwin") {
    const shellCommand = `cd ${shellQuote(useDir)} && ${command}`;
    try {
      const child = spawn("osascript", [
        "-e", `tell application "Terminal" to do script ${JSON.stringify(shellCommand)}`,
        "-e", 'tell application "Terminal" to activate',
      ], { detached: true, stdio: devMode ? "inherit" : "ignore" });
      child.unref();
      return true;
    } catch (err) {
      if (devMode) console.error(`[continue] macOS terminal launch failed: ${err.message}`);
      return false;
    }
  }
  // Prefer Windows Terminal; fall back to a detached cmd window.
  for (const attempt of [
    () => spawn("wt.exe", ["-d", useDir, "cmd", "/k", command], { detached: true, stdio: "ignore" }),
    () => spawn("cmd.exe", ["/c", "start", "cmd", "/k", `cd /d "${useDir}" && ${command}`], { detached: true, stdio: "ignore" }),
  ]) {
    try {
      const child = attempt();
      child.unref();
      return true;
    } catch {
      /* try next */
    }
  }
  if (devMode) console.error("[continue] no supported terminal launcher succeeded");
  return false;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

// --- rendering -------------------------------------------------------------

function queryPath(basePath, params) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${basePath}?${query}` : basePath;
}

function filterThreads(all, { areaFilter, goalFilter, harnessFilter, machineFilter, q }) {
  let filtered = all.filter((t) => (
    (!areaFilter || t.intent_area === areaFilter)
    && (!goalFilter || goalForThread(t.thread_id)?.id === goalFilter)
    && (!harnessFilter || (t.harnesses || []).includes(harnessFilter))
    && (!machineFilter || (t.machines || []).includes(machineFilter))
  ));

  if (q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length > 0) {
      filtered = filtered.filter((t) => {
        const transcriptText = _searchIndex[t.thread_id]?.transcriptText || "";
        const fullText = [
          t.title || "",
          t.display_title || "",
          t.outcome_intent || "",
          t.notes || "",
          t.where_it_stands || "",
          t.next_step || "",
          t.intent_area || "",
          goalForThread(t.thread_id)?.title || "",
          goalForThread(t.thread_id)?.area || "",
          t.repo_key || "",
          (t.harnesses || []).join(" "),
          (t.machines || []).join(" "),
          transcriptText
        ].join(" ").toLowerCase();
        return terms.every((term) => fullText.includes(term));
      });
    }
  }
  return filtered;
}

function filterSummary(threads, { areaFilter, goalFilter, harnessFilter, machineFilter, q }) {
  const parts = [];
  if (areaFilter) parts.push(`in ${esc(areaFilter)}`);
  if (goalFilter) parts.push(`for ${esc(goalForId(goalFilter)?.title || goalFilter)}`);
  if (harnessFilter) parts.push(`via ${esc(harnessFilter)}`);
  if (machineFilter) parts.push(`on ${esc(machineFilter)}`);
  if (q) parts.push(`matching "${esc(q)}"`);
  return `${threads.length} threads${parts.length ? ` ${parts.join(" ")}` : ""}`;
}

function areaChipBar(all, areaFilter, goalFilter, harnessFilter, machineFilter, q, basePath) {
  const areas = [...new Set(all.map((t) => t.intent_area || "Other / Unsorted"))].sort();
  const scoped = filterThreads(all, { goalFilter, harnessFilter, machineFilter, q });
  const getQ = (a) => queryPath(basePath, { area: a || "", goal: goalFilter || "", harness: harnessFilter || "", machine: machineFilter || "", q: q || "" });
  return [
    `<a class="chip${areaFilter ? "" : " on"}" href="${getQ("")}">All areas (${scoped.length})</a>`,
    ...areas.map((a) => {
      const n = scoped.filter((t) => t.intent_area === a).length;
      return `<a class="chip${areaFilter === a ? " on" : ""}" href="${getQ(a)}">${esc(a)} (${n})</a>`;
    }),
  ].join("");
}

function goalChipBar(all, goalFilter, areaFilter, harnessFilter, machineFilter, q, basePath) {
  const goals = goalsForThreads(all).sort((a, b) => a.title.localeCompare(b.title));
  const scoped = filterThreads(all, { areaFilter, harnessFilter, machineFilter, q });
  const getQ = (goal) => queryPath(basePath, { area: areaFilter || "", goal: goal || "", harness: harnessFilter || "", machine: machineFilter || "", q: q || "" });
  return [
    `<a class="chip${goalFilter ? "" : " on"}" href="${getQ("")}">All goals (${scoped.length})</a>`,
    ...goals.map((goal) => {
      const n = scoped.filter((t) => goalForThread(t.thread_id)?.id === goal.id).length;
      if (!n) return "";
      return `<a class="chip goal-chip${goalFilter === goal.id ? " on" : ""}" href="${getQ(goal.id)}" title="${esc(goal.outcome_statement)}">${esc(truncate(goal.title, 42))} (${n})</a>`;
    }).filter(Boolean),
  ].join("");
}

// Harness filter: a thread matches a harness if any of its sessions used it.
function harnessChipBar(all, harnessFilter, areaFilter, goalFilter, machineFilter, q, basePath) {
  const harnesses = [...new Set(all.flatMap((t) => t.harnesses || []))].sort();
  const scoped = filterThreads(all, { areaFilter, goalFilter, machineFilter, q });
  const getQ = (h) => queryPath(basePath, { area: areaFilter || "", goal: goalFilter || "", harness: h || "", machine: machineFilter || "", q: q || "" });
  return [
    `<a class="chip${harnessFilter ? "" : " on"}" href="${getQ("")}">All harnesses (${scoped.length})</a>`,
    ...harnesses.map((h) => {
      const n = scoped.filter((t) => (t.harnesses || []).includes(h)).length;
      return `<a class="chip${harnessFilter === h ? " on" : ""}" href="${getQ(h)}">${esc(h)} (${n})</a>`;
    }),
  ].join("");
}

function machineChipBar(all, machineFilter, areaFilter, goalFilter, harnessFilter, q, basePath) {
  const machines = [...new Set(all.flatMap((t) => t.machines || []))].sort();
  const scoped = filterThreads(all, { areaFilter, goalFilter, harnessFilter, q });
  const getQ = (m) => queryPath(basePath, { area: areaFilter || "", goal: goalFilter || "", harness: harnessFilter || "", machine: m || "", q: q || "" });
  return [
    `<a class="chip${machineFilter ? "" : " on"}" href="${getQ("")}">All machines (${scoped.length})</a>`,
    ...machines.map((m) => {
      const n = scoped.filter((t) => (t.machines || []).includes(m)).length;
      return `<a class="chip${machineFilter === m ? " on" : ""}" href="${getQ(m)}">${esc(m)} (${n})</a>`;
    }),
  ].join("");
}

function nav(active, searchParams) {
  const params = {};
  if (searchParams) {
    if (searchParams.get("area")) params.area = searchParams.get("area");
    if (searchParams.get("goal")) params.goal = searchParams.get("goal");
    if (searchParams.get("harness")) params.harness = searchParams.get("harness");
    if (searchParams.get("machine")) params.machine = searchParams.get("machine");
    if (searchParams.get("q")) params.q = searchParams.get("q");
  }
  params.from = active;
  
  const link = (href, label) => {
    const targetHref = queryPath(href, params);
    return `<a class="${active === href ? "navon" : ""}" href="${targetHref}">${label}</a>`;
  };
  
  const refreshHref = queryPath("/refresh", params);
  return `<div class="nav">${link("/", "List view")} ${link("/kanban", "Kanban view")}
    ${link("/goals", "Goals")}
    ${link("/goal-threads", "Goal Buckets")}
    ${link("/telemetry", "Telemetry Insights")}
    ${link("/kanban-ipsum", "Shareable")} ·
    <a href="${refreshHref}">refresh now</a></div>`;
}

function renderSearchForm(q, areaFilter, goalFilter, harnessFilter, machineFilter) {
  return `
    <div class="search-container">
      <form action="" method="GET" class="search-form" id="search-form">
        ${areaFilter ? `<input type="hidden" name="area" value="${esc(areaFilter)}">` : ""}
        ${goalFilter ? `<input type="hidden" name="goal" value="${esc(goalFilter)}">` : ""}
        ${harnessFilter ? `<input type="hidden" name="harness" value="${esc(harnessFilter)}">` : ""}
        ${machineFilter ? `<input type="hidden" name="machine" value="${esc(machineFilter)}">` : ""}
        <input type="search" name="q" class="search-input" placeholder="Search threads & transcripts..." value="${esc(q)}" autocomplete="off" id="search-input">
        ${q ? `<button type="button" class="clear-btn" id="clear-search-btn" title="Clear search">&times;</button>` : ""}
        <button type="submit" class="search-btn">Search</button>
      </form>
    </div>
    <script>
      (function() {
        var clearBtn = document.getElementById("clear-search-btn");
        var searchInput = document.getElementById("search-input");
        var searchForm = document.getElementById("search-form");
        if (clearBtn && searchInput && searchForm) {
          clearBtn.addEventListener("click", function() {
            searchInput.value = "";
            searchForm.submit();
          });
        }
      })();
    </script>
  `;
}

function renderBoard(searchParams) {
  const areaFilter = searchParams.get("area") || "";
  const goalFilter = searchParams.get("goal") || "";
  const harnessFilter = searchParams.get("harness") || "";
  const machineFilter = searchParams.get("machine") || "";
  const q = searchParams.get("q") || "";
  const all = visibleThreads(loadRegistry());
  const threads = filterThreads(all, { areaFilter, goalFilter, harnessFilter, machineFilter, q });

  // Reverse flow order — Done at the top, Funnel at the bottom — so the eye
  // lands on finishing before starting. Done starts collapsed.
  const sections = [...LIST_ORDER].reverse().map((stage) => {
    const items = threads
      .filter((t) => t.stage === stage)
      .sort((a, b) => (b.staleness_hours || 0) - (a.staleness_hours || 0));
    if (!items.length) return "";
    const open = stage === "Done / Archive Candidates" ? "" : " open";
    return `<details class="stage-sec"${open}>
      <summary><span class="stage-name">${esc(stage)}</span> <span class="count">${items.length}</span></summary>
      <div class="stage-body">${items.map(renderCard).join("")}</div>
    </details>`;
  }).join("");

  return page("AI Thread Board", `
    <header>
      <h1>AI Thread Board</h1>
      ${nav("/", searchParams)}
      <div class="meta">${filterSummary(threads, { areaFilter, goalFilter, harnessFilter, machineFilter, q })} · auto-refreshes every 60s</div>
    </header>
    ${renderSearchForm(q, areaFilter, goalFilter, harnessFilter, machineFilter)}
    <div class="chips">${goalChipBar(all.filter(t => t.stage !== "Done / Archive Candidates"), goalFilter, areaFilter, harnessFilter, machineFilter, q, "/")}</div>
    <div class="chips">${areaChipBar(all.filter(t => t.stage !== "Done / Archive Candidates"), areaFilter, goalFilter, harnessFilter, machineFilter, q, "/")}</div>
    <div class="chips chips-harness">${harnessChipBar(all.filter(t => t.stage !== "Done / Archive Candidates"), harnessFilter, areaFilter, goalFilter, machineFilter, q, "/")}</div>
    <div class="chips">${machineChipBar(all.filter(t => t.stage !== "Done / Archive Candidates"), machineFilter, areaFilter, goalFilter, harnessFilter, q, "/")}</div>
    ${sections || "<p>No threads.</p>"}
  `);
}

function renderKanban(searchParams, ipsum) {
  const areaFilter = ipsum ? "" : (searchParams.get("area") || "");
  const goalFilter = ipsum ? "" : (searchParams.get("goal") || "");
  const harnessFilter = ipsum ? "" : (searchParams.get("harness") || "");
  const machineFilter = ipsum ? "" : (searchParams.get("machine") || "");
  const q = ipsum ? "" : (searchParams.get("q") || "");
  const all = visibleThreads(loadRegistry());
  const threads = ipsum ? all : filterThreads(all, { areaFilter, goalFilter, harnessFilter, machineFilter, q });

  const lanes = STAGE_ORDER.map((stage) => {
    const items = threads
      .filter((t) => t.stage === stage)
      .sort((a, b) => (b.staleness_hours || 0) - (a.staleness_hours || 0));
    const muted = MUTED_STAGES.has(stage);
    const cards = items.map((t) => {
      const title = ipsum ? loremTitle(t) : (t.display_title || t.title);
      let tip = ipsum ? esc(ageLabel(t)) : `${esc(t.intent_area || "")} — ${esc(ageLabel(t))}`;
      if (!ipsum && t.next_step) tip += ` — Next: ${esc(t.next_step)}`;
      const blk = (!ipsum && t.blocked) ? '<span class="blk">BLOCKED</span> ' : "";
      const drag = (ipsum || t.isSkillMaintenance) ? "" : ` draggable="true" data-id="${t.thread_id}"`;
      const s0 = (t.sessions || [])[0] || {};
      let acts = "";
      if (!ipsum) {
        const a = [];
        if (s0.resume && !t.isSkillMaintenance) {
          a.push(`<a class="mini-act" data-fetch href="/continue?id=${t.thread_id}" title="Continue this session" draggable="false">&#9654;</a>`);
          if (t.next_step) {
            a.push(`<a class="mini-act act-next" data-fetch href="/continue?id=${t.thread_id}&step=1" title="Continue with next action — also copies the suggested next step: ${esc(t.next_step)}" draggable="false">&#9197;</a>`);
          }
        }
        if (s0.transcript_path && !t.isSkillMaintenance) {
          a.push(`<a class="mini-act" href="/log?id=${t.thread_id}" title="Review the session log" draggable="false">&#128196;</a>`);
        }
        if (t.isSkillMaintenance) {
          a.push(`<a class="mini-act" href="/telemetry" title="View telemetry insights" draggable="false" style="background:#ffe6dc; color:#ea580c; font-weight:bold;">&#128736; info</a>`);
        }
        if (a.length) acts = `<span class="mini-acts">${a.join("")}</span>`;
      }
      const goalBadge = !ipsum ? renderGoalBadgeForThread(t, true) : "";
      return `
      <div class="mini${t.aging ? " mini-aging" : ""}${t.blocked ? " mini-blocked" : ""}${ipsum ? "" : " mini-open"}"${drag}
         style="border-left-color:${areaColor(t.intent_area)}" title="${tip}">
         <span class="mini-title">${esc(truncate(title, 90))}</span>
        ${goalBadge}
        <span class="mini-foot">
          <span class="mini-meta">${blk}${agePill(t)} <span class="mini-dim">${(t.harnesses || []).join("/")}${!ipsum && machineLabel(t) ? ` · ${esc(machineLabel(t))}` : ""}</span></span>
          ${acts}
        </span>
      </div>`;
    }).join("");
    return `<div class="lane${muted ? " lane-muted" : ""}" data-stage="${esc(stage)}">
      <div class="lane-head">${esc(stage.split(" / ")[0])} <span class="count">${items.length}</span></div>
      <div class="lane-body">${cards || '<div class="lane-empty">—</div>'}</div>
    </div>`;
  }).join("");

  if (ipsum) {
    return page("Thread Board — Shareable", `
      <header>
        <h1>Thread Board <span class="dim">(shareable view)</span></h1>
        ${nav("/kanban-ipsum", searchParams)}
        <div class="meta">${threads.length} threads · card titles obfuscated — safe to screenshot</div>
      </header>
      <div class="board">${lanes}</div>
    `);
  }
  return page("AI Thread Board — Kanban", `
    <header>
      <h1>AI Thread Board — Kanban</h1>
      ${nav("/kanban", searchParams)}
      <div class="meta">${filterSummary(threads, { areaFilter, goalFilter, harnessFilter, machineFilter, q })} ·
        drag a card to another lane to change its stage</div>
    </header>
    ${renderSearchForm(q, areaFilter, goalFilter, harnessFilter, machineFilter)}
    <div class="chips">${goalChipBar(all.filter(t => t.stage !== "Done / Archive Candidates"), goalFilter, areaFilter, harnessFilter, machineFilter, q, "/kanban")}</div>
    <div class="chips">${areaChipBar(all.filter(t => t.stage !== "Done / Archive Candidates"), areaFilter, goalFilter, harnessFilter, machineFilter, q, "/kanban")}</div>
    <div class="chips chips-harness">${harnessChipBar(all.filter(t => t.stage !== "Done / Archive Candidates"), harnessFilter, areaFilter, goalFilter, machineFilter, q, "/kanban")}</div>
    <div class="chips">${machineChipBar(all.filter(t => t.stage !== "Done / Archive Candidates"), machineFilter, areaFilter, goalFilter, harnessFilter, q, "/kanban")}</div>
    <div class="board" id="board">${lanes}</div>
    <div id="modal" class="modal-overlay" hidden>
      <div class="modal-box">
        <button class="modal-close" aria-label="Close">&times;</button>
        <div id="modal-body"></div>
      </div>
    </div>
    ${DRAG_SCRIPT}
  `);
}

function renderGoalsKanban(searchParams) {
  const network = loadGoalNetwork();
  const q = searchParams.get("q") || "";
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matchingGoals = terms.length
    ? (network.goals || []).filter((goal) => {
        const text = [
          goal.id,
          goal.title,
          goal.outcome_statement,
          goal.area,
          goal.lifecycle_stage,
          goal.traction_status,
          ...(goal.supporting_threads || []).map((thread) => `${thread.thread_id} ${thread.title} ${thread.outcome_intent}`),
        ].join(" ").toLowerCase();
        return terms.every((term) => text.includes(term));
      })
    : (network.goals || []);
  const goals = [...matchingGoals].sort((a, b) => (
    GOAL_STAGE_ORDER.indexOf(goalLifecycle(a)) - GOAL_STAGE_ORDER.indexOf(goalLifecycle(b))
    || (b.supporting_threads || []).length - (a.supporting_threads || []).length
    || a.title.localeCompare(b.title)
  ));

  const summary = goalReviewSummary(goals);
  const lanes = GOAL_STAGE_ORDER.map((stage) => {
    const items = goals.filter((goal) => goalLifecycle(goal) === stage);
    const muted = MUTED_GOAL_STAGES.has(stage);
    const cards = items.map(renderGoalMiniCard).join("");
    return `<div class="lane goal-lane${muted ? " lane-muted" : ""}" data-stage="${esc(stage)}">
      <div class="lane-head">${esc(stage)} <span class="count">${items.length}</span></div>
      <div class="lane-body">${cards || '<div class="lane-empty">-</div>'}</div>
    </div>`;
  }).join("");

  const empty = goals.length ? "" : `
    <div class="card">
      <div class="title">No goal network found</div>
      <div class="intent">Run <code>npm run goals</code> or refresh after a registry exists.</div>
    </div>`;

  return page("AI Goal Board", `
    <header>
      <h1>AI Goal Board</h1>
      ${nav("/goals", searchParams)}
      <div class="meta">${goals.length} goals${q ? ` matching "${esc(q)}"` : ""} · ${summary} · drag goals to update lifecycle state · <a href="/goal-threads">move threads between goals</a></div>
    </header>
    <div class="search-container">
      <form action="/goals" method="GET" class="search-form">
        <input type="search" name="q" class="search-input" placeholder="Search goals & supporting threads..." value="${esc(q)}" autocomplete="off">
        ${q ? `<button type="button" class="clear-btn" onclick="location.href='/goals'" title="Clear search">&times;</button>` : ""}
        <button type="submit" class="search-btn">Search</button>
      </form>
    </div>
    ${empty || `<div class="board" id="goal-board">${lanes}</div>${GOAL_DRAG_SCRIPT}`}
  `);
}

function renderGoalThreadBuckets(searchParams) {
  const network = loadGoalNetwork();
  const q = searchParams.get("q") || "";
  const requestedGoal = searchParams.get("goal") || "";
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const allThreads = visibleThreads(loadRegistry()).filter((thread) => !thread.isSkillMaintenance);
  const goals = (network.goals || []).map((goal) => {
    const allGoalThreads = (goal.supporting_threads || [])
      .map((support) => findThread(support.thread_id))
      .filter(Boolean)
      .sort((a, b) => (b.staleness_hours || 0) - (a.staleness_hours || 0));
    const threads = allGoalThreads.filter((thread) => threadGoalBucketMatches(thread, goal, terms));
    return { goal, allThreads: allGoalThreads, threads };
  });
  const assignedThreadIds = new Set((network.goals || []).flatMap((goal) => (goal.supporting_threads || []).map((thread) => thread.thread_id)));
  const allUnassignedThreads = allThreads
    .filter((thread) => !assignedThreadIds.has(thread.thread_id))
    .sort((a, b) => (b.staleness_hours || 0) - (a.staleness_hours || 0));
  const unassignedThreads = allUnassignedThreads.filter((thread) => threadGoalBucketMatches(thread, null, terms));
  const sortedGoals = goals.sort((a, b) => (
    b.allThreads.length - a.allThreads.length
    || a.goal.title.localeCompare(b.goal.title)
  ));
  const defaultGoal = sortedGoals[0]?.goal?.id || (allUnassignedThreads.length ? "__unassigned" : "");
  const selectedGoalId = requestedGoal === "__unassigned" || sortedGoals.some(({ goal }) => goal.id === requestedGoal)
    ? requestedGoal
    : defaultGoal;
  const selected = selectedGoalId === "__unassigned"
    ? { goal: null, allThreads: allUnassignedThreads, threads: unassignedThreads }
    : sortedGoals.find(({ goal }) => goal.id === selectedGoalId) || { goal: null, allThreads: [], threads: [] };
  const movedCount = allThreads.filter((thread) => hasReviewedGoalOverride(thread.thread_id)).length;
  const bucketCount = sortedGoals.length + (allUnassignedThreads.length ? 1 : 0);
  const goalList = [
    ...sortedGoals.map(({ goal, allThreads: goalThreads }) => renderGoalExplorerListItem(goal, goalThreads.length, selectedGoalId)),
    allUnassignedThreads.length ? renderGoalExplorerUnassignedItem(allUnassignedThreads.length, selectedGoalId) : "",
  ].join("");
  const detail = selected.goal
    ? renderGoalExplorerDetail(selected.goal, selected.threads, selected.allThreads.length, q)
    : renderUnassignedExplorerDetail(selected.threads, selected.allThreads.length, q);
  const empty = bucketCount ? "" : `
    <div class="card">
      <div class="title">No goals found</div>
      <div class="intent">Refresh the goal network.</div>
    </div>`;

  return page("AI Goal Thread Buckets", `
    <header>
      <h1>AI Goal Thread Buckets</h1>
      ${nav("/goal-threads", searchParams)}
      <div class="meta">${allThreads.length} live threads · ${movedCount} reviewed goal moves · select a goal on the left, drag a thread onto another goal to move it · <a href="/goals">manage goal lifecycle</a></div>
    </header>
    <div class="search-container">
      <form action="/goal-threads" method="GET" class="search-form">
        ${selectedGoalId ? `<input type="hidden" name="goal" value="${esc(selectedGoalId)}">` : ""}
        <input type="search" name="q" class="search-input" placeholder="Search threads in the selected goal..." value="${esc(q)}" autocomplete="off">
        ${q ? `<button type="button" class="clear-btn" onclick="location.href='${selectedGoalId ? `/goal-threads?goal=${encodeURIComponent(selectedGoalId)}` : "/goal-threads"}'" title="Clear search">&times;</button>` : ""}
        <button type="submit" class="search-btn">Search</button>
      </form>
    </div>
    ${empty || `<div class="goal-explorer" id="thread-goal-board">
      <aside class="goal-explorer-sidebar">${goalList}${renderGoalCreateForm()}</aside>
      <main class="goal-explorer-detail">${detail}</main>
    </div>${THREAD_GOAL_DRAG_SCRIPT}`}
  `);
}

function renderGoalCreateForm() {
  return `
    <form class="goal-create-form" action="/create-goal" method="GET">
      <div class="goal-create-title">New goal</div>
      <input name="title" class="goal-create-input" placeholder="Goal title" required autocomplete="off">
      <input name="area" class="goal-create-input" placeholder="Area" autocomplete="off">
      <input name="outcome" class="goal-create-input" placeholder="Outcome statement" autocomplete="off">
      <button type="submit" class="goal-create-btn">Create</button>
    </form>`;
}

function renderGoalExplorerListItem(goal, threadCount, selectedGoalId) {
  const status = goal.weekly_review?.status || goal.traction_status || "red";
  const fitCounts = goal.weekly_review?.association_review?.counts || {};
  const misfit = fitCounts.possible_misfit || 0;
  const selected = goal.id === selectedGoalId;
  return `
    <a class="goal-explorer-item${selected ? " selected" : ""}" data-goal-id="${esc(goal.id)}" href="${queryPath("/goal-threads", { goal: goal.id })}" style="--goal-color:${goalStatusColor(status)}">
      <span class="goal-explorer-title">${esc(truncate(goal.title, 78))}</span>
      <span class="goal-explorer-meta">
        <span>${threadCount} threads</span>
        ${misfit ? `<span class="blk">${misfit} fit?</span>` : ""}
      </span>
    </a>`;
}

function renderGoalExplorerUnassignedItem(threadCount, selectedGoalId) {
  return `
    <a class="goal-explorer-item goal-explorer-unassigned${selectedGoalId === "__unassigned" ? " selected" : ""}" href="${queryPath("/goal-threads", { goal: "__unassigned" })}">
      <span class="goal-explorer-title">Unassigned</span>
      <span class="goal-explorer-meta"><span>${threadCount} threads</span></span>
    </a>`;
}

function renderGoalExplorerDetail(goal, threads, totalThreads, q) {
  const status = goal.weekly_review?.status || goal.traction_status || "red";
  const canvasHref = goalCanvasHref(goal);
  const fitCounts = goal.weekly_review?.association_review?.counts || {};
  const fitSummary = fitCounts.possible_misfit
    ? `${fitCounts.possible_misfit} possible misfit${fitCounts.possible_misfit === 1 ? "" : "s"}`
    : (fitCounts.strong_fit ? `${fitCounts.strong_fit} strong fit${fitCounts.strong_fit === 1 ? "" : "s"}` : "");
  const overrideCount = threads.filter((thread) => hasReviewedGoalOverride(thread.thread_id)).length;
  return `
    <section class="goal-explorer-current" data-current-goal="${esc(goal.id)}" style="--goal-color:${goalStatusColor(status)}">
      <div class="goal-explorer-head">
        <div>
          <a class="thread-goal-title" href="${queryPath("/kanban", { goal: goal.id })}">${esc(goal.title)}</a>
          <div class="thread-goal-sub">${esc(goal.area || "")} · ${esc(goalLifecycle(goal))}${fitSummary ? ` · ${esc(fitSummary)}` : ""}</div>
          ${canvasHref ? `<a class="thread-goal-canvas" href="${canvasHref}">intent canvas</a>` : ""}
        </div>
        <span class="count">${q ? `${threads.length}/${totalThreads}` : totalThreads}</span>
      </div>
      ${renderGoalEditForm(goal)}
      <div class="thread-goal-dropzone">
        ${threads.map((thread) => renderGoalThreadCard(thread, goal)).join("") || '<div class="lane-empty">No matching threads in this goal</div>'}
      </div>
      ${overrideCount ? `<div class="thread-goal-note">${overrideCount} reviewed move${overrideCount === 1 ? "" : "s"} in view</div>` : ""}
    </section>`;
}

function renderGoalEditForm(goal) {
  return `
    <form class="goal-edit-form" action="/update-goal" method="GET">
      <input type="hidden" name="id" value="${esc(goal.id)}">
      <label class="goal-edit-label">Name
        <input name="title" class="goal-edit-input" value="${esc(goal.title)}" required autocomplete="off">
      </label>
      <label class="goal-edit-label">Area
        <input name="area" class="goal-edit-input" value="${esc(goal.area || "")}" autocomplete="off">
      </label>
      <label class="goal-edit-label">Outcome
        <textarea name="outcome" class="goal-edit-textarea" required>${esc(goal.outcome_statement || "")}</textarea>
      </label>
      <button type="submit" class="goal-edit-btn">Save goal</button>
    </form>`;
}

function renderUnassignedExplorerDetail(threads, totalThreads, q) {
  return `
    <section class="goal-explorer-current goal-explorer-current-unassigned">
      <div class="goal-explorer-head">
        <div>
          <span class="thread-goal-title">Unassigned</span>
          <div class="thread-goal-sub">No current goal-network match</div>
        </div>
        <span class="count">${q ? `${threads.length}/${totalThreads}` : totalThreads}</span>
      </div>
      <div class="thread-goal-dropzone">
        ${threads.map((thread) => renderGoalThreadCard(thread, null)).join("") || '<div class="lane-empty">No matching unassigned threads</div>'}
      </div>
    </section>`;
}

function renderGoalThreadBucket(goal, threads) {
  const status = goal.weekly_review?.status || goal.traction_status || "red";
  const overrideCount = threads.filter((thread) => hasReviewedGoalOverride(thread.thread_id)).length;
  const canvasHref = goalCanvasHref(goal);
  const fitCounts = goal.weekly_review?.association_review?.counts || {};
  const fitSummary = fitCounts.possible_misfit
    ? `${fitCounts.possible_misfit} possible misfit${fitCounts.possible_misfit === 1 ? "" : "s"}`
    : (fitCounts.strong_fit ? `${fitCounts.strong_fit} strong fit${fitCounts.strong_fit === 1 ? "" : "s"}` : "");
  return `
    <section class="thread-goal-bucket" data-goal-id="${esc(goal.id)}" style="--goal-color:${goalStatusColor(status)}">
      <div class="thread-goal-head">
        <div>
          <a class="thread-goal-title" href="${queryPath("/kanban", { goal: goal.id })}">${esc(goal.title)}</a>
          <div class="thread-goal-sub">${esc(goal.area || "")} · ${esc(goalLifecycle(goal))}${fitSummary ? ` · ${esc(fitSummary)}` : ""}</div>
          ${canvasHref ? `<a class="thread-goal-canvas" href="${canvasHref}">intent canvas</a>` : ""}
        </div>
        <span class="count">${threads.length}</span>
      </div>
      <div class="thread-goal-dropzone">
        ${threads.map((thread) => renderGoalThreadCard(thread, goal)).join("") || '<div class="lane-empty">Drop threads here</div>'}
      </div>
      ${overrideCount ? `<div class="thread-goal-note">${overrideCount} reviewed move${overrideCount === 1 ? "" : "s"}</div>` : ""}
    </section>`;
}

function renderUnassignedThreadBucket(threads) {
  return `
    <section class="thread-goal-bucket thread-goal-unassigned">
      <div class="thread-goal-head">
        <div>
          <span class="thread-goal-title">Unassigned</span>
          <div class="thread-goal-sub">No current goal-network match</div>
        </div>
        <span class="count">${threads.length}</span>
      </div>
      <div class="thread-goal-dropzone">
        ${threads.map((thread) => renderGoalThreadCard(thread, null)).join("")}
      </div>
    </section>`;
}

function renderGoalThreadCard(thread, goal) {
  const s0 = (thread.sessions || [])[0] || {};
  const reviewed = hasReviewedGoalOverride(thread.thread_id);
  const title = thread.display_title || thread.title;
  const next = thread.next_step ? `<span class="goal-thread-next">${esc(truncate(thread.next_step, 90))}</span>` : "";
  return `
    <div class="mini thread-goal-card${thread.aging ? " mini-aging" : ""}${thread.blocked ? " mini-blocked" : ""}" draggable="true" data-id="${esc(thread.thread_id)}"
      style="border-left-color:${areaColor(thread.intent_area)}" title="${esc(thread.outcome_intent || "")}">
      <span class="mini-title">${esc(truncate(title, 82))}</span>
      <span class="goal-thread-meta">
        <span>${esc(thread.stage || "")}</span>
        ${agePill(thread)}
        ${reviewed ? "<span>reviewed goal</span>" : ""}
      </span>
      ${next}
      <span class="mini-foot">
        <span class="mini-meta"><span class="mini-dim">${esc((thread.harnesses || []).join("/") || "")}${machineLabel(thread) ? ` · ${esc(machineLabel(thread))}` : ""}</span></span>
        <span class="mini-acts">
          ${s0.transcript_path ? `<a class="mini-act" href="/log?id=${thread.thread_id}" draggable="false">&#128196;</a>` : ""}
          ${goal ? `<a class="mini-act" href="${queryPath("/kanban", { goal: goal.id, q: thread.thread_id })}" draggable="false">focus</a>` : ""}
        </span>
      </span>
    </div>`;
}

function threadGoalBucketMatches(thread, goal, terms) {
  if (!terms.length) return true;
  const text = [
    goal?.id || "",
    goal?.title || "",
    goal?.outcome_statement || "",
    goal?.area || "",
    thread.thread_id || "",
    thread.title || "",
    thread.display_title || "",
    thread.outcome_intent || "",
    thread.where_it_stands || "",
    thread.next_step || "",
    thread.intent_area || "",
    thread.stage || "",
  ].join(" ").toLowerCase();
  return terms.every((term) => text.includes(term));
}

function hasReviewedGoalOverride(threadId) {
  return Boolean(loadGoalOverrides().thread_overrides[threadId]?.goal_id);
}

function renderGoalMiniCard(goal) {
  const review = goal.weekly_review || {};
  const association = review.association_review || {};
  const fitCounts = association.counts || {};
  const canvasHref = goalCanvasHref(goal);
  const metrics = review.metrics || {};
  const next = review.next_best_action?.text || (goal.next_actions || [])[0]?.text || "";
  const status = review.status || goal.traction_status || "red";
  const threadCount = (goal.supporting_threads || []).length;
  const traction = metrics.traction_evidence ?? (goal.traction_evidence || []).length;
  const activity = metrics.activity_evidence ?? (goal.activity_evidence || []).length;
  const blockerCount = (goal.blockers || []).length;
  return `
    <div class="mini goal-mini" draggable="true" data-id="${esc(goal.id)}"
      style="border-left-color:${goalStatusColor(status)}" title="${esc(goal.outcome_statement || "")}">
      <span class="mini-title">${esc(truncate(goal.title, 90))}</span>
      <span class="goal-area">${esc(goal.area || "")}</span>
      <span class="goal-meta">
        <span class="goal-status">${esc(status)}</span>
        <span>${threadCount} threads</span>
        <span>${traction} traction</span>
        <span>${activity} activity</span>
        ${blockerCount ? `<span class="blk">${blockerCount} blocked</span>` : ""}
        ${fitCounts.possible_misfit ? `<span class="blk">${fitCounts.possible_misfit} fit?</span>` : ""}
      </span>
      ${next ? `<span class="goal-next">${esc(truncate(next, 130))}</span>` : ""}
      <span class="mini-foot">
        <span class="mini-meta"><span class="mini-dim">${esc(goal.confidence || "low")} confidence</span></span>
        <span class="mini-acts">
          ${canvasHref ? `<a class="mini-act" href="${canvasHref}" draggable="false" title="Open goal intent canvas">canvas</a>` : ""}
          <a class="mini-act" href="${queryPath("/goal-threads", { goal: goal.id })}" draggable="false">fit</a>
          <a class="mini-act" href="${queryPath("/kanban", { goal: goal.id })}" draggable="false">threads</a>
        </span>
      </span>
    </div>`;
}

function goalCanvasHref(goal) {
  if (!goal?.intent_canvas_ref) return "";
  const absPath = path.resolve(repoRoot, goal.intent_canvas_ref);
  if (!absPath.startsWith(repoRoot + path.sep)) return "";
  return `vscode://file/${encodeURI(absPath.replace(/\\/g, "/"))}`;
}

const GOAL_DRAG_SCRIPT = `<script>
(function () {
  var board = document.getElementById("goal-board");
  if (!board) return;
  var dragId = null;
  board.addEventListener("dragstart", function (e) {
    var card = e.target.closest(".goal-mini[data-id]");
    if (!card) return;
    dragId = card.getAttribute("data-id");
    e.dataTransfer.effectAllowed = "move";
  });
  board.addEventListener("dragover", function (e) {
    if (e.target.closest(".goal-lane")) e.preventDefault();
  });
  board.addEventListener("dragenter", function (e) {
    var lane = e.target.closest(".goal-lane");
    if (lane) lane.classList.add("lane-over");
  });
  board.addEventListener("dragleave", function (e) {
    var lane = e.target.closest(".goal-lane");
    if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove("lane-over");
  });
  board.addEventListener("drop", function (e) {
    var lane = e.target.closest(".goal-lane");
    if (!lane || !dragId) return;
    e.preventDefault();
    lane.classList.remove("lane-over");
    fetch("/set-goal-stage?id=" + encodeURIComponent(dragId) + "&stage=" + encodeURIComponent(lane.getAttribute("data-stage")))
      .then(function (r) { if (!r.ok) throw new Error("bad status"); location.reload(); })
      .catch(function () { alert("Could not update goal stage."); });
  });
})();
</script>`;

const THREAD_GOAL_DRAG_SCRIPT = `<script>
(function () {
  var board = document.getElementById("thread-goal-board");
  if (!board) return;
  var dragId = null;
  board.addEventListener("dragstart", function (e) {
    var card = e.target.closest(".thread-goal-card[data-id]");
    if (!card) return;
    dragId = card.getAttribute("data-id");
    e.dataTransfer.effectAllowed = "move";
  });
  board.addEventListener("dragover", function (e) {
    if (e.target.closest(".goal-explorer-item[data-goal-id]")) e.preventDefault();
  });
  board.addEventListener("dragenter", function (e) {
    var target = e.target.closest(".goal-explorer-item[data-goal-id]");
    if (target) target.classList.add("lane-over");
  });
  board.addEventListener("dragleave", function (e) {
    var target = e.target.closest(".goal-explorer-item[data-goal-id]");
    if (target && !target.contains(e.relatedTarget)) target.classList.remove("lane-over");
  });
  board.addEventListener("drop", function (e) {
    var target = e.target.closest(".goal-explorer-item[data-goal-id]");
    if (!target || !dragId) return;
    e.preventDefault();
    target.classList.remove("lane-over");
    board.style.opacity = "0.55";
    fetch("/set-thread-goal?id=" + encodeURIComponent(dragId) + "&goal=" + encodeURIComponent(target.getAttribute("data-goal-id")))
      .then(function (r) { if (!r.ok) throw new Error("bad status"); location.reload(); })
      .catch(function () { board.style.opacity = "1"; alert("Could not update thread goal."); });
    dragId = null;
  });
})();
</script>`;

const DRAG_SCRIPT = `<script>
(function () {
  var board = document.getElementById("board");
  if (!board) return;
  var dragId = null;
  var modal = document.getElementById("modal");
  var modalBody = document.getElementById("modal-body");

  // Fire a continue/log action link in place — fetch, flash, no navigation.
  function fireAction(link) {
    link.style.opacity = "0.35";
    fetch(link.getAttribute("href"))
      .then(function () { link.style.opacity = "1"; link.classList.add("act-fired"); })
      .catch(function () { link.style.opacity = "1"; });
  }
  function closeModal() { modal.hidden = true; modalBody.innerHTML = ""; }
  function openModal(id) {
    fetch("/card?id=" + encodeURIComponent(id))
      .then(function (r) { return r.text(); })
      .then(function (html) { modalBody.innerHTML = html; modal.hidden = false; });
  }

  board.addEventListener("click", function (e) {
    var act = e.target.closest(".mini-act[data-fetch]");
    if (act) { e.preventDefault(); fireAction(act); return; }
    if (e.target.closest(".mini-act")) return; // log link — navigate normally
    var card = e.target.closest(".mini[data-id]");
    if (card) openModal(card.getAttribute("data-id"));
  });

  // Modal: backdrop / close button dismiss; continue links fire in place.
  modal.addEventListener("click", function (e) {
    if (e.target === modal || e.target.closest(".modal-close")) { closeModal(); return; }
    var cont = e.target.closest('a[href^="/continue"]');
    if (cont) { e.preventDefault(); fireAction(cont); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  board.addEventListener("dragstart", function (e) {
    var card = e.target.closest(".mini[data-id]");
    if (!card) return;
    dragId = card.getAttribute("data-id");
    e.dataTransfer.effectAllowed = "move";
  });
  board.addEventListener("dragover", function (e) {
    if (e.target.closest(".lane")) { e.preventDefault(); }
  });
  board.addEventListener("dragenter", function (e) {
    var lane = e.target.closest(".lane");
    if (lane) lane.classList.add("lane-over");
  });
  board.addEventListener("dragleave", function (e) {
    var lane = e.target.closest(".lane");
    if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove("lane-over");
  });
  board.addEventListener("drop", function (e) {
    var lane = e.target.closest(".lane");
    if (!lane || !dragId) return;
    e.preventDefault();
    lane.classList.remove("lane-over");
    var stage = lane.getAttribute("data-stage");
    board.style.opacity = "0.5";
    fetch("/set-stage?id=" + encodeURIComponent(dragId) + "&stage=" + encodeURIComponent(stage))
      .then(function (r) { location.reload(); })
      .catch(function () { board.style.opacity = "1"; });
    dragId = null;
  });
})();
</script>`;

// Deterministic placeholder title for a thread — stable across refreshes,
// roughly the word count of the real title, carrying no real content.
const LOREM = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
  "sed", "tempor", "labore", "magna", "aliqua", "veniam", "nostrud", "ullamco",
  "laboris", "aliquip", "commodo", "consequat", "aute", "irure", "voluptate",
  "cillum", "fugiat", "nulla", "pariatur", "proident", "officia", "deserunt",
];

function loremTitle(t) {
  let seed = 0;
  for (const ch of String(t.thread_id || t.title || "x")) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const realWords = String(t.display_title || t.title || "").trim().split(/\s+/).length;
  const count = Math.max(3, Math.min(8, realWords));
  const words = [];
  for (let i = 0; i < count; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    words.push(LOREM[seed % LOREM.length]);
  }
  return words.join(" ").replace(/^./, (c) => c.toUpperCase());
}

function areaColor(area) {
  const palette = {
    "LinkedIn & Prospecting": "#2563eb",
    "CRM & Pipeline Data": "#0891b2",
    "Content & Publishing": "#16a34a",
    "Podcast": "#9333ea",
    "Thought Leadership & POV": "#c026d3",
    "Skill Library & Agent Infra": "#ea580c",
    "Site & Web": "#0d9488",
    "Meetings & Clients": "#ca8a04",
    "Job Search": "#dc2626",
    "Sales & Proposals": "#65a30d",
  };
  return palette[area] || "#94a3b8";
}

function renderGoalBadgeForThread(t, compact = false) {
  const goal = goalForThread(t.thread_id);
  if (!goal) return "";
  const status = goal.traction_status || "red";
  const cls = compact ? "mini-goal-badge" : "goal-badge";
  return `<a class="${cls} goal-${esc(status)}" href="${queryPath("/kanban", { goal: goal.id })}" title="${esc(goal.outcome_statement)}">${esc(truncate(goal.title, compact ? 28 : 52))}</a>`;
}

function tractionLabel(goal) {
  const status = goal.traction_status || "red";
  if (status === "green") return "Green";
  if (status === "yellow") return "Yellow";
  return "Red";
}

function goalStageFor(goal) {
  return GOAL_STAGE_ORDER.includes(goal.lifecycle_stage)
    ? goal.lifecycle_stage
    : "Considering / Exploring";
}

const LOCAL_MACHINE = os.hostname();
// Short label for which machine(s) own a thread's sessions. Hide when the
// only owner is the local machine — that's the common case and not worth
// the visual noise. Show "X + 1 more" when multiple, "X" when remote-only.
function machineLabel(t) {
  const ms = (t.machines || []).filter(Boolean);
  if (!ms.length) return "";
  if (ms.length === 1) return ms[0] === LOCAL_MACHINE ? "" : ms[0];
  const others = ms.filter((m) => m !== LOCAL_MACHINE);
  if (!others.length) return `${ms.length} machines`;
  return ms.includes(LOCAL_MACHINE)
    ? `${others[0]}${others.length > 1 ? ` +${others.length - 1}` : ""} + local`
    : `${others[0]}${others.length > 1 ? ` +${others.length - 1}` : ""}`;
}

function renderCard(t) {
  const s = (t.sessions || [])[0] || {};
  const aging = t.aging ? ` <span class="badge aging">&#9888; AGING &middot; ${esc(ageLabel(t))}</span>` : "";
  const blocked = t.blocked ? ' <span class="badge blocked">&#9209; BLOCKED</span>' : "";
  const harness = (t.harnesses || []).join(", ");
  
  const isMaint = t.isSkillMaintenance;
  
  const logLink = (!isMaint && s.transcript_path)
    ? `<a class="btn" href="/log?id=${t.thread_id}">&#128196; log</a>
       <a class="btn ghost" href="vscode://file/${encodeURI(s.transcript_path.replace(/\\/g, "/"))}">open in editor</a>`
    : "";
    
  const continueBtn = isMaint
    ? `<a class="btn go" href="/telemetry" style="background:#ea580c">&#128736; telemetry insights</a>`
    : (s.resume ? `<a class="btn go" href="/continue?id=${t.thread_id}${t.next_step ? "&step=1" : ""}" title="${t.next_step ? "Opens the session and copies the next-step prompt to your clipboard" : "Resume this session"}">&#9654; continue${t.next_step ? " + copy step" : ""}</a>` : "");
    
  const nextStep = t.next_step
    ? `<div class="nextstep"><span class="ns-label">&#9654; Next step</span> ${esc(t.next_step)}</div>`
    : "";
  const goalBadge = renderGoalBadgeForThread(t);
    
  const titleText = isMaint ? `&#128736; ${esc(t.title)}` : esc(t.display_title || t.title);
  
  return `
    <div class="card${t.aging ? " is-aging" : ""}" id="t-${t.thread_id}">
      <div class="card-head">
        <span class="title">${titleText}</span>${blocked}${aging}
        <span class="badge area">${esc(t.intent_area || "Other / Unsorted")}</span>
        ${goalBadge}
      </div>
      <div class="intent">${esc(truncate(t.outcome_intent, 240))}</div>
      <div class="standing">${esc(t.status || "")} — ${esc(truncate(t.where_it_stands || "", 160))}</div>
      ${t.notes ? `<div class="notes">note: ${esc(t.notes)}</div>` : ""}
      ${nextStep}
      <div class="card-foot">
        <span class="dim">${agePill(t)} ${esc(harness)} · ${esc(t.repo_key || "")}${t.session_count > 1 ? ` · ${t.session_count} sessions` : ""}${machineLabel(t) ? ` · &#128187; ${esc(machineLabel(t))}` : ""}</span>
        <span class="actions">${continueBtn}${logLink}</span>
      </div>
    </div>`;
}

function renderLog(t, session) {
  // Preamble is already stripped by readTranscript. Show the head (where the
  // real conversation starts — the intent) and the tail (where it stands),
  // collapsing the middle so the log is readable without the overhead.
  const all = readTranscript(session.transcript_path);
  const HEAD = 5;
  const TAIL = 8;
  let shown;
  let omitted = 0;
  if (all.length <= HEAD + TAIL) {
    shown = all;
  } else {
    omitted = all.length - HEAD - TAIL;
    shown = [...all.slice(0, HEAD), { gap: omitted }, ...all.slice(-TAIL)];
  }
  const body = shown.map((m) => {
    if (m.gap) {
      return `<div class="log-gap">— ${m.gap} messages hidden · open the raw transcript for the full thread —</div>`;
    }
    return `<div class="msg ${m.role}">
      <div class="role">${esc(m.role)}</div>
      <div class="text">${esc(clip(m.text, 1800))}</div>
    </div>`;
  }).join("");
  const note = omitted
    ? `head + tail — first ${HEAD}, last ${TAIL}, ${omitted} middle hidden · preamble trimmed`
    : `${all.length} messages · preamble trimmed`;
  return page(`Log — ${t.title}`, `
    <header>
      <h1>${esc(t.display_title || t.title)}</h1>
      <div class="meta">${esc(session.harness)} · ${esc(t.repo_key || "")} · ${esc(note)} ·
        <a href="/">&larr; board</a> ·
        <a href="vscode://file/${encodeURI(session.transcript_path.replace(/\\/g, "/"))}">open raw transcript</a></div>
    </header>
    <div class="log">${body || "<p>No readable messages.</p>"}</div>
  `);
}

// --- transcript parsing ----------------------------------------------------

// Injected-context prefixes — messages that are harness preamble, not the
// user's actual conversation (instruction blocks, IDE context, slash commands).
const PREAMBLE_PREFIXES = [
  "<environment", "<local-command", "<ide_opened_file", "<ide_selection",
  "<system-reminder", "<command-name", "<command-message", "<command-args",
  "<permissions", "<user_instructions", "<user-instructions",
  "# agents.md instructions", "# claude.md", "# context from my ide setup",
  "# files mentioned by the user",
];

// Real content of a user message, or null if the message is pure preamble.
function messageContent(text) {
  let s = String(text || "").trim();
  // A real request wrapped in IDE/files context — take the request itself.
  const marker = s.match(/##\s*my request(?: for [a-z]+)?\s*:?\s*/i);
  if (marker) s = s.slice(marker.index + marker[0].length).trim();
  if (!s) return null;
  const lc = s.toLowerCase();
  if (PREAMBLE_PREFIXES.some((p) => lc.startsWith(p))) return null;
  // Any opening tag whose name ends in "instruction(s)" — <permissions
  // instructions>, <user instructions>, <instructions>, etc.
  if (/^<[\w -]*instructions?\b/i.test(s)) return null;
  if (lc.includes("<instructions>") && s.length > 400) return null;
  return s;
}

function clip(s, n) {
  return s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s;
}

function readTranscript(file) {
  const out = [];
  for (const line of readLines(file)) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const m = extractMessage(o);
    if (!m || !m.text) continue;
    if (m.role === "user") {
      const content = messageContent(m.text);
      if (!content) continue; // injected preamble — drop it
      m.text = content;
    }
    out.push(m);
  }
  return out;
}

function extractMessage(o) {
  // Claude
  if (o.type === "user" && o.message?.content) return { role: "user", text: flatten(o.message.content) };
  if (o.type === "assistant" && o.message?.content) return { role: "assistant", text: flatten(o.message.content) };
  // Codex
  if (o.type === "response_item" && o.payload?.type === "message") {
    const role = o.payload.role === "assistant" ? "assistant" : "user";
    return { role, text: flatten(o.payload.content) };
  }
  if (o.type === "event_msg" && o.payload?.type === "agent_message") {
    return { role: "assistant", text: String(o.payload.message || "") };
  }
  // Gemini
  if (o.type === "user" && o.content) return { role: "user", text: flatten(o.content) };
  if ((o.type === "gemini" || o.type === "model") && o.content) return { role: "assistant", text: flatten(o.content) };
  // Antigravity
  if (o.type === "USER_INPUT" && o.content) return { role: "user", text: o.content };
  if (o.type === "PLANNER_RESPONSE" && o.content && o.source === "MODEL") return { role: "assistant", text: o.content };
  return null;
}

function flatten(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p.text || p.content || "")).filter(Boolean).join(" ");
  }
  return "";
}

// --- helpers ---------------------------------------------------------------

function loadRegistry() {
  return _registryCache;
}

function loadGoalNetwork({ force = false } = {}) {
  if (_goalNetworkCache && !force) return _goalNetworkCache;
  if (!fs.existsSync(goalNetworkPath)) return { goals: [] };
  try {
    const network = JSON.parse(fs.readFileSync(goalNetworkPath, "utf8"));
    setGoalNetworkCache(network);
    return network;
  } catch {
    return { goals: [] };
  }
}

function setGoalNetworkCache(network) {
  const byThread = new Map();
  for (const goal of network.goals || []) {
    for (const thread of goal.supporting_threads || []) {
      if (thread.thread_id) byThread.set(thread.thread_id, goal);
    }
  }
  _goalNetworkCache = network;
  _goalByThreadId = byThread;
}

function findThread(id) {
  if (!id) return null;
  return loadRegistry().find((t) => t.thread_id === id) || null;
}

function goalForThread(threadId) {
  if (!_goalNetworkCache || !_goalByThreadId.has(threadId)) loadGoalNetwork({ force: true });
  return _goalByThreadId.get(threadId) || null;
}

function goalForId(goalId) {
  return (loadGoalNetwork().goals || []).find((goal) => goal.id === goalId) || null;
}

function findGoal(goalId) {
  return goalForId(goalId);
}

function goalsForThreads(threads) {
  const ids = new Set(threads.map((thread) => goalForThread(thread.thread_id)?.id).filter(Boolean));
  return (loadGoalNetwork().goals || []).filter((goal) => ids.has(goal.id));
}

function loadGoalOverrides() {
  if (!fs.existsSync(goalOverridesPath)) {
    return { schema_version: 1, goals: {}, thread_overrides: {}, goal_overrides: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(goalOverridesPath, "utf8"));
    return {
      schema_version: parsed.schema_version || 1,
      goals: parsed.goals && typeof parsed.goals === "object" ? parsed.goals : {},
      thread_overrides: parsed.thread_overrides && typeof parsed.thread_overrides === "object" ? parsed.thread_overrides : {},
      goal_overrides: parsed.goal_overrides && typeof parsed.goal_overrides === "object" ? parsed.goal_overrides : {},
    };
  } catch {
    return { schema_version: 1, goals: {}, thread_overrides: {}, goal_overrides: {} };
  }
}

function saveGoalOverrides(overrides) {
  fs.writeFileSync(goalOverridesPath, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
}

function slugifyGoalId(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "manual-goal";
}

function uniqueGoalId(baseId, overrides) {
  const existingIds = new Set([
    ...Object.keys(overrides.goals || {}),
    ...(loadGoalNetwork().goals || []).map((goal) => goal.id),
  ]);
  let id = baseId;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${baseId}-${n}`;
    n += 1;
  }
  return id;
}

function rebuildGoalNetworkSync() {
  try {
    execFileSync(process.execPath, [path.join(scriptDir, "extract-goal-network.mjs")], { stdio: "ignore" });
    loadGoalNetwork({ force: true });
  } catch {
    /* the override is still saved; the next refresh can rebuild */
  }
}

function goalLifecycle(goal) {
  return GOAL_STAGE_ORDER.includes(goal.lifecycle_stage) ? goal.lifecycle_stage : GOAL_STAGE_ORDER[0];
}

function goalReviewSummary(goals) {
  const counts = {};
  for (const goal of goals) {
    const status = goal.weekly_review?.status || goal.traction_status || "red";
    counts[status] = (counts[status] || 0) + 1;
  }
  return Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(" · ") || "no review yet";
}

function goalStatusColor(status) {
  const colors = {
    progressing: "#16a34a",
    no_progress: "#ca8a04",
    unobservable: "#64748b",
    blocked: "#b91c1c",
    green: "#16a34a",
    yellow: "#ca8a04",
    red: "#b91c1c",
  };
  return colors[status] || "#94a3b8";
}

function ageLabel(t) {
  if (t.staleness_hours == null) return "age unknown";
  const h = t.staleness_hours;
  return h < 48 ? `${h}h idle` : `${Math.round(h / 24)}d idle`;
}

// Severity tier for idle time: aging = past the stage SLE, warm = >2 days
// idle, fresh otherwise. Drives the colour of the idle pill.
function staleTier(t) {
  if (t.aging) return "aging";
  return (t.staleness_hours || 0) > 48 ? "warm" : "fresh";
}

function agePill(t) {
  // Idle time is meaningless once a thread is done.
  if (t.stage === "Done / Archive Candidates") return "";
  return `<span class="age age-${staleTier(t)}">${esc(ageLabel(t))}</span>`;
}

// Archived threads are permanently off the board.
// Done-stage threads with staleness > 14 days are also hidden automatically.
function visibleThreads(threads) {
  const cutoffHours = 14 * 24;
  const filtered = threads.filter((t) => {
    if (t.status === "archived") return false;
    if (t.stage === "Done / Archive Candidates" && (t.staleness_hours || 0) > cutoffHours) return false;
    return true;
  });

  // Inject synthetic skill maintenance cards if telemetry has friction!
  try {
    const events = loadTelemetryEvents();
    if (events && events.length) {
      const activeEvents = events.filter((ev) => 
        ev.confidence === "confirmed" && 
        ["transcript_skill_path", "hook_tool_read", "hook_tool_operation"].includes(ev.evidence_source) &&
        !isPlaceholderSkill(ev.skill_name)
      );
      
      const skillStats = {};
      activeEvents.forEach((ev) => {
        const s = ev.skill_name;
        if (!skillStats[s]) skillStats[s] = { total: 0, failed: 0, friction: 0, harnesses: new Set() };
        skillStats[s].total++;
        if (ev.outcome === "failed") skillStats[s].failed++;
        if (ev.friction_reasons && ev.friction_reasons.length) skillStats[s].friction += ev.friction_reasons.length;
        if (ev.harness) skillStats[s].harnesses.add(ev.harness);
      });
      
      Object.entries(skillStats).forEach(([skill, stat]) => {
        if (stat.failed > 0 || stat.friction >= 2) {
          // Generate a candidate skill maintenance card
          filtered.push({
            thread_id: `skill-maint-${skill}`,
            title: `[SKILL MAINTENANCE] Improve '${skill}'`,
            display_title: `[SKILL MAINTENANCE] Improve '${skill}'`,
            intent_area: "Skill Library & Agent Infra",
            outcome_intent: `Telemetry has detected active friction in the '${skill}' skill. Click below to view the detailed telemetry dashboard and plan optimizations.`,
            where_it_stands: `Friction score: ${stat.friction}. Failures: ${stat.failed}.`,
            stage: "Funnel / Triage",
            harnesses: Array.from(stat.harnesses),
            session_count: stat.total,
            staleness_hours: 0,
            aging: false,
            blocked: false,
            isSkillMaintenance: true,
            notes: `Friction signals present in ${stat.total} active-use sessions.`
          });
        }
      });
    }
  } catch (err) {
    // Silently proceed on error
  }
  return filtered;
}

function readLines(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
}

function truncate(text, n) {
  const c = String(text || "").replace(/\s+/g, " ").trim();
  return c.length > n ? `${c.slice(0, n - 3)}...` : c;
}

function esc(text) {
  return String(text || "").replace(/[&<>"]/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]
  ));
}

function sendHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
}

function page(title, body) {
  const machinesPath = path.join(dir, "machines.json");
  let statusHtml = "";
  if (fs.existsSync(machinesPath)) {
    try {
      let text = fs.readFileSync(machinesPath, "utf8");
      if (text.startsWith("\ufeff")) {
        text = text.slice(1);
      }
      const data = JSON.parse(text);
      const items = [];
      for (const [mName, mInfo] of Object.entries(data)) {
        const hList = [];
        for (const [hName, hInfo] of Object.entries(mInfo.harnesses || {})) {
          if (hInfo.installed) {
            hList.push(`${hName} (v${hInfo.version || "0.1.0"})`);
          }
        }
        
        let runnerInfo = "";
        if (mInfo.server) {
          runnerInfo += ` · server v${mInfo.server.version || "0.1.0"}`;
        }
        if (mInfo.scanner) {
          runnerInfo += ` · scanner v${mInfo.scanner.version || "0.1.0"}`;
        }

        items.push(`<div class="machine-status"><strong>${esc(mName)}</strong>: v${esc(mInfo.version || "0.1.0")}${runnerInfo} [harnesses: ${esc(hList.join(", ") || "none")}]</div>`);
      }
      if (items.length) {
        statusHtml = `<div class="system-status-bar"><div class="system-status-title">Yuval-OS System Status</div>${items.join("")}</div>`;
      }
    } catch (err) {}
  }

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta http-equiv="refresh" content="60">
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 -apple-system,Segoe UI,sans-serif; margin: 0; background: #f4f5f7; color: #1a1a2e; }
  header { padding: 18px 24px 8px; }
  h1 { margin: 0; font-size: 20px; }
  .meta { color: #667; font-size: 12px; margin-top: 4px; }
  .meta a, header a { color: #2563eb; text-decoration: none; }
  .nav { margin-top: 6px; font-size: 13px; }
  .nav a { color: #2563eb; text-decoration: none; padding: 2px 8px; border-radius: 6px; }
  .nav a.navon { background: #2563eb; color: #fff; }
  .board { display: flex; gap: 10px; padding: 8px 20px 40px; overflow-x: auto; align-items: flex-start; }
  .lane { flex: 0 0 230px; background: #e9ebf0; border-radius: 8px; padding: 6px; transition: background .12s; }
  .lane-muted { opacity: .55; }
  .lane-over { background: #d6e4ff; outline: 2px dashed #2563eb; }
  .lane-head { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; color: #445; padding: 4px 6px; }
  .lane-body { display: flex; flex-direction: column; gap: 5px; min-height: 28px; }
  .lane-empty { color: #aab; text-align: center; padding: 8px; }
  .mini { display: block; background: #fff; border-radius: 6px; border-left: 3px solid #94a3b8; padding: 6px 8px; text-decoration: none; color: #1a1a2e; cursor: grab; }
  .mini:active { cursor: grabbing; }
  .mini:hover { background: #f0f3ff; }
  .mini-aging { background: #fff1ee; box-shadow: inset 0 0 0 2px #e0533b; }
  .mini-blocked { box-shadow: inset 0 0 0 2px #b91c1c; }
  .mini-title { display: block; font-size: 12px; line-height: 1.35; color: #1a1a2e; text-decoration: none; }
  .mini-title:hover { color: #2563eb; }
  .mini-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10px; margin-top: 6px; }
  .mini-meta { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .mini-dim { color: #889; }
  .mini-foot .age { font-size: 10px; padding: 1px 5px; }
  .mini-acts { display: flex; gap: 3px; flex: none; }
  .mini-act { text-decoration: none; font-size: 11px; line-height: 1; padding: 3px 5px; border-radius: 4px; background: #e8ecf6; color: #2563eb; }
  .mini-act:hover { background: #2563eb; color: #fff; }
  .mini-act.act-next { background: #dcfce7; color: #16a34a; }
  .mini-act.act-next:hover, .mini-act.act-fired { background: #16a34a; color: #fff; }
  .goal-lane { flex-basis: 260px; }
  .goal-mini { cursor: grab; }
  .goal-area { display: block; margin-top: 3px; color: #667; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  .goal-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; color: #667; font-size: 10px; }
  .goal-meta span { background: #eef1f6; border-radius: 4px; padding: 1px 5px; }
  .goal-status { font-weight: 700; text-transform: uppercase; }
  .goal-next { display: block; margin-top: 6px; color: #445; font-size: 11px; line-height: 1.35; }
  .goal-badge, .mini-goal-badge { text-decoration: none; border-radius: 4px; font-weight: 700; }
  .goal-badge { font-size: 11px; padding: 1px 7px; }
  .mini-goal-badge { display: inline-block; margin-top: 5px; font-size: 10px; padding: 1px 5px; max-width: 100%; box-sizing: border-box; }
  .goal-red { background: #fee2e2; color: #991b1b; }
  .goal-yellow { background: #fef3c7; color: #92400e; }
  .goal-green { background: #dcfce7; color: #166534; }
  .goal-explorer { display: grid; grid-template-columns: minmax(240px, 320px) minmax(420px, 1fr); gap: 12px; padding: 8px 20px 40px; align-items: start; }
  .goal-explorer-sidebar { position: sticky; top: 8px; display: flex; flex-direction: column; gap: 4px; max-height: calc(100vh - 16px); overflow: auto; background: #e9ebf0; border-radius: 8px; padding: 7px; }
  .goal-explorer-item { display: block; background: #fff; border-left: 4px solid var(--goal-color, #94a3b8); border-radius: 6px; padding: 7px 8px; color: #1a1a2e; text-decoration: none; transition: background .12s, outline .12s; }
  .goal-explorer-item:hover, .goal-explorer-item.selected { background: #f0f3ff; }
  .goal-explorer-item.selected { outline: 2px solid #2563eb; }
  .goal-explorer-unassigned { opacity: .72; border-left-color: #64748b; }
  .goal-explorer-title { display: block; font-size: 12px; font-weight: 700; line-height: 1.25; }
  .goal-explorer-meta { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: #667; font-size: 10px; }
  .goal-explorer-meta span { background: #eef1f6; border-radius: 4px; padding: 1px 5px; }
  .goal-create-form { margin-top: 8px; padding: 8px; border-top: 1px solid #d7dbe6; display: grid; gap: 6px; }
  .goal-create-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #556; }
  .goal-create-input { width: 100%; box-sizing: border-box; border: 1px solid #ccd3df; border-radius: 5px; padding: 6px 7px; font: inherit; font-size: 12px; background: #fff; color: #1a1a2e; }
  .goal-create-btn { border: 0; border-radius: 5px; background: #2563eb; color: #fff; padding: 6px 8px; font-weight: 700; cursor: pointer; }
  .goal-create-btn:hover { background: #1d4ed8; }
  .goal-explorer-detail { min-width: 0; }
  .goal-explorer-current { background: #e9ebf0; border-radius: 8px; padding: 8px; border-top: 4px solid var(--goal-color, #94a3b8); }
  .goal-explorer-current-unassigned { opacity: .8; border-top-color: #64748b; }
  .goal-explorer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding: 4px 5px 8px; }
  .goal-edit-form { display: grid; gap: 7px; background: #f8fafc; border: 1px solid #d7dbe6; border-radius: 7px; padding: 9px; margin-bottom: 8px; }
  .goal-edit-label { display: grid; gap: 3px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #556; }
  .goal-edit-input, .goal-edit-textarea { width: 100%; box-sizing: border-box; border: 1px solid #ccd3df; border-radius: 5px; padding: 6px 7px; font: inherit; font-size: 12px; background: #fff; color: #1a1a2e; text-transform: none; font-weight: 400; }
  .goal-edit-textarea { min-height: 58px; resize: vertical; line-height: 1.35; }
  .goal-edit-btn { justify-self: start; border: 0; border-radius: 5px; background: #2563eb; color: #fff; padding: 6px 9px; font-weight: 700; cursor: pointer; }
  .goal-edit-btn:hover { background: #1d4ed8; }
  .goal-thread-board { display: flex; gap: 10px; padding: 8px 20px 40px; overflow-x: auto; align-items: flex-start; }
  .thread-goal-bucket { flex: 0 0 286px; background: #e9ebf0; border-radius: 8px; padding: 7px; border-top: 4px solid var(--goal-color, #94a3b8); transition: background .12s; }
  .thread-goal-unassigned { opacity: .72; border-top-color: #64748b; }
  .thread-goal-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 3px 4px 7px; }
  .thread-goal-title { display: block; color: #1a1a2e; font-size: 12px; font-weight: 700; line-height: 1.25; text-decoration: none; }
  .thread-goal-title:hover { color: #2563eb; }
  .thread-goal-sub { color: #667; font-size: 10px; line-height: 1.25; margin-top: 2px; }
  .thread-goal-canvas { display: inline-block; color: #2563eb; font-size: 10px; text-decoration: none; margin-top: 3px; }
  .thread-goal-canvas:hover { text-decoration: underline; }
  .thread-goal-dropzone { display: flex; flex-direction: column; gap: 5px; min-height: 48px; }
  .thread-goal-card { cursor: grab; }
  .goal-thread-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 5px; color: #667; font-size: 10px; }
  .goal-thread-meta span { background: #eef1f6; border-radius: 4px; padding: 1px 5px; }
  .goal-thread-next { display: block; margin-top: 5px; color: #445; font-size: 11px; line-height: 1.3; }
  .thread-goal-note { margin-top: 7px; color: #667; font-size: 10px; text-align: right; }
  .blk { background: #b91c1c; color: #fff; font-weight: 700; font-size: 9px; padding: 1px 4px; border-radius: 3px; }
  .badge.blocked { background: #b91c1c; color: #fff; font-weight: 700; font-size: 11px; padding: 2px 8px; }
  @media (max-width: 760px) {
    .goal-explorer { grid-template-columns: 1fr; }
    .goal-explorer-sidebar { position: static; max-height: 260px; }
  }
  h2 { margin: 22px 24px 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #556; }
  .count { background: #dde; border-radius: 10px; padding: 1px 8px; font-size: 11px; }
  details.stage-sec { margin: 0 24px; }
  details.stage-sec > summary { cursor: pointer; list-style: none; margin: 20px 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #556; user-select: none; }
  details.stage-sec > summary::-webkit-details-marker { display: none; }
  details.stage-sec > summary::before { content: "\\25B8\\00a0\\00a0"; color: #99a; }
  details.stage-sec[open] > summary::before { content: "\\25BE\\00a0\\00a0"; }
  .stage-sec .card { margin-left: 0; margin-right: 0; }
  .modal-overlay { position: fixed; inset: 0; background: rgba(20,20,40,.5); display: flex; align-items: flex-start; justify-content: center; padding: 36px 16px; overflow: auto; z-index: 50; }
  .modal-overlay[hidden] { display: none; }
  .modal-box { position: relative; background: #f4f5f7; border-radius: 10px; width: 100%; max-width: 660px; padding: 30px 14px 14px; box-shadow: 0 12px 40px rgba(0,0,0,.3); }
  .modal-close { position: absolute; top: 4px; right: 12px; border: none; background: transparent; font-size: 24px; line-height: 1; cursor: pointer; color: #667; }
  .modal-box .card { margin: 0; }
  .chips { padding: 4px 20px 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  .search-container { margin: 8px 20px 12px; display: flex; gap: 8px; max-width: 500px; }
  .search-form { display: flex; width: 100%; gap: 6px; align-items: center; background: #fff; border: 1px solid #c8cdd8; border-radius: 20px; padding: 2px 4px 2px 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .search-input { flex: 1; border: none; background: transparent; color: #1a1a2e; font-size: 13px; padding: 6px 0; outline: none; }
  .search-input::placeholder { color: #889; }
  .search-btn { padding: 5px 14px; border-radius: 16px; border: none; background: #2563eb; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s, transform 0.1s; }
  .search-btn:hover { background: #1d4ed8; }
  .search-btn:active { transform: scale(0.97); }
  .clear-btn { background: transparent; border: none; color: #667; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; display: flex; align-items: center; justify-content: center; height: 22px; width: 22px; border-radius: 50%; }
  .clear-btn:hover { background: #f1f3f9; color: #1a1a2e; }
  @media (prefers-color-scheme: dark) {
    .search-form { background: #1e293b; border-color: #334155; }
    .search-input { color: #f8fafc; }
    .clear-btn:hover { background: #334155; color: #f8fafc; }
  }
  .chips-harness { padding-top: 0; }
  .chips-harness .chip { background: #f1f5f9; font-size: 11px; padding: 2px 9px; }
  .chips-harness .chip.on { background: #0f172a; color: #fff; }
  .chip { font-size: 12px; padding: 3px 10px; border-radius: 12px; background: #e6e8ee; color: #334; text-decoration: none; }
  .chip.on { background: #2563eb; color: #fff; }
  .card { background: #fff; margin: 6px 24px; padding: 10px 14px; border-radius: 8px; border-left: 3px solid #c8cdd8; }
  .card.is-aging { border-left: 6px solid #e0533b; background: #fff5f3; box-shadow: 0 0 0 1px #f3c4ba; }
  .card-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .title { font-weight: 600; font-size: 14px; }
  .intent { color: #445; margin: 3px 0; }
  .standing { color: #667; font-size: 12px; }
  .notes { color: #8a5a00; font-size: 12px; margin-top: 3px; }
  .nextstep { margin-top: 6px; padding: 5px 8px; background: #eef4ff; border-radius: 6px; font-size: 12px; color: #1e3a5f; }
  .ns-label { font-weight: 700; color: #2563eb; }
  .ns-dot { color: #2563eb; font-size: 9px; }
  .card-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 10px; flex-wrap: wrap; }
  .dim { color: #889; font-size: 12px; }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 4px; }
  .badge.area { background: #eef; color: #335; }
  .badge.aging { background: #e0533b; color: #fff; font-weight: 700; font-size: 11px; padding: 2px 8px; letter-spacing: .03em; }
  .age { font-weight: 600; padding: 1px 7px; border-radius: 4px; font-size: 11px; }
  .age-fresh { background: #e6f4ea; color: #1a7f37; }
  .age-warm { background: #fde8b0; color: #8a5a00; }
  .age-aging { background: #e0533b; color: #fff; }
  .btn { font-size: 12px; padding: 4px 10px; border-radius: 6px; text-decoration: none; background: #e6e8ee; color: #223; }
  .btn.go { background: #16a34a; color: #fff; }
  .btn.ghost { background: transparent; color: #2563eb; }
  .log { margin: 8px 24px 40px; }
  .log-gap { text-align: center; color: #889; font-size: 11px; margin: 12px 0; }
  .msg { background: #fff; border-radius: 8px; margin: 6px 0; padding: 8px 12px; }
  .msg.user { border-left: 3px solid #2563eb; }
  .msg.assistant { border-left: 3px solid #16a34a; }
  .role { font-size: 11px; text-transform: uppercase; color: #889; }
  .text { white-space: pre-wrap; word-break: break-word; }
  .system-status-bar { background: #e2e8f0; border-top: 1px solid #cbd5e1; padding: 12px 24px; font-size: 11px; color: #475569; margin-top: 40px; }
  .system-status-title { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; font-size: 10px; color: #334155; }
  .machine-status { margin: 2px 0; }
  @media (prefers-color-scheme: dark) {
    .system-status-bar { background: #1e293b; border-color: #334155; color: #94a3b8; }
    .system-status-title { color: #cbd5e1; }
  }
</style></head><body>${body}${statusHtml}</body></html>`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const has = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--");
      out[key] = has ? argv[++i] : true;
    }
  }
  return out;
}


// --- Skill Telemetry Integration (Insights & Funnel) -------------------------

function resolveMemoryRoot() {
  const env = process.env.AI_AGENT_MEMORY_ROOT || process.env.AGENT_MEMORY_ROOT;
  if (env) return path.resolve(env);
  const configPath = path.join(os.homedir(), ".config", "ai-skills", "agent-memory-root");
  if (fs.existsSync(configPath)) {
    const root = fs.readFileSync(configPath, "utf8").trim();
    if (root) return path.resolve(root);
  }
  const regDir = resolveRegistryDir();
  if (fs.existsSync(path.join(regDir, "skill-telemetry"))) {
    return regDir;
  }
  const parent = path.dirname(path.dirname(regDir));
  if (fs.existsSync(path.join(parent, "skill-telemetry"))) {
    return parent;
  }
  return path.join(os.homedir(), ".agent-memory");
}

function loadTelemetryEvents() {
  const memoryRoot = resolveMemoryRoot();
  const file = path.join(memoryRoot, "skill-telemetry", "events.jsonl");
  if (!fs.existsSync(file)) return [];
  try {
    const text = fs.readFileSync(file, "utf8");
    const events = [];
    const seen = new Set();
    text.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      try {
        const ev = JSON.parse(line);
        const key = ev.event_id || `${ev.session_id}-${ev.skill_name}-${ev.evidence_source}-${ev.sequence_index}-${ev.captured_at}`;
        if (!seen.has(key)) {
          seen.add(key);
          events.push(ev);
        }
      } catch (err) {}
    });
    return events;
  } catch (err) {
    return [];
  }
}

function isPlaceholderSkill(skill) {
  if (!skill) return true;
  const s = skill.trim();
  return (
    s.includes("<") || s.includes(">") || s.includes("{") || s.includes("}") ||
    s.includes("$") || s.includes("(") || s.includes(")") || s.includes("_") ||
    s === "unknown" || s === "default"
  );
}

function renderTelemetry(searchParams) {
  const events = loadTelemetryEvents();
  const allKnown = new Set();
  
  try {
    const skillsDir = path.join(os.homedir(), "Github", "ai-skill-library", "skills");
    if (fs.existsSync(skillsDir)) {
      fs.readdirSync(skillsDir).forEach((name) => {
        if (fs.statSync(path.join(skillsDir, name)).isDirectory() && fs.existsSync(path.join(skillsDir, name, "SKILL.md"))) {
          allKnown.add(name);
        }
      });
    }
  } catch (err) {}

  const seen = new Set();
  const deduped = [];
  let duplicates = 0;
  events.forEach((ev) => {
    const key = ev.event_id || `${ev.session_id}-${ev.skill_name}-${ev.evidence_source}-${ev.sequence_index}-${ev.captured_at}`;
    if (seen.has(key)) {
      duplicates++;
    } else {
      seen.add(key);
      deduped.push(ev);
    }
  });

  const CONFIRMED_SOURCES = new Set(["transcript_skill_path", "hook_tool_read", "hook_tool_operation"]);
  const activeEvents = deduped.filter((ev) => 
    ev.confidence === "confirmed" && 
    CONFIRMED_SOURCES.has(ev.evidence_source) &&
    !isPlaceholderSkill(ev.skill_name)
  );

  const activeSessions = new Set(deduped.map((ev) => ev.session_id).filter(Boolean));
  const activeSkills = new Set(activeEvents.map((ev) => ev.skill_name).filter(Boolean));

  const harnessCounts = {};
  deduped.forEach((ev) => {
    const h = ev.harness || "unknown";
    harnessCounts[h] = (harnessCounts[h] || 0) + 1;
  });

  const skillStats = {};
  activeEvents.forEach((ev) => {
    const s = ev.skill_name;
    if (!skillStats[s]) {
      skillStats[s] = {
        name: s,
        events: 0,
        sessions: new Set(),
        repos: new Set(),
        harnesses: new Set(),
        failed: 0,
        frictionReasons: [],
        partialUse: false
      };
    }
    const stat = skillStats[s];
    stat.events++;
    if (ev.session_id) stat.sessions.add(ev.session_id);
    if (ev.repo) stat.repos.add(ev.repo);
    if (ev.harness) stat.harnesses.add(ev.harness);
    if (ev.outcome === "failed") stat.failed++;
    if (ev.friction_reasons && ev.friction_reasons.length) {
      stat.frictionReasons.push(...ev.friction_reasons);
    }
    if (ev.partial_use) stat.partialUse = true;
  });

  const activeList = Object.values(skillStats).map((stat) => {
    let action = "keep";
    if (stat.failed > 0 || stat.frictionReasons.length >= 2) {
      action = "improve";
    } else if (stat.partialUse) {
      action = "split or bundle review";
    } else if (stat.sessions.size >= 2) {
      action = "keep and watch";
    } else {
      action = "ignore-for-now";
    }
    return {
      name: stat.name,
      events: stat.events,
      sessions: stat.sessions.size,
      repos: Array.from(stat.repos).join(", "),
      harnesses: Array.from(stat.harnesses).join(", "),
      action: action,
      failures: stat.failed,
      friction: stat.frictionReasons.length
    };
  }).sort((a, b) => b.sessions - a.sessions || b.events - a.events);

  const unusedList = Array.from(allKnown).filter((name) => !skillStats[name]).sort();

  const top10 = activeList.slice(0, 10);
  const chartHeight = Math.max(100, top10.length * 36 + 20);
  let svgChart = `<svg width="100%" height="${chartHeight}" viewBox="0 0 600 ${chartHeight}" style="background:#fff; border-radius:8px; padding:10px; box-sizing:border-box;">`;
  if (top10.length === 0) {
    svgChart += `<text x="300" y="${chartHeight / 2}" text-anchor="middle" fill="#667" font-size="14">No active skill usage data yet</text>`;
  } else {
    const maxSessions = Math.max(...top10.map((d) => d.sessions), 1);
    top10.forEach((d, idx) => {
      const y = idx * 36 + 20;
      const barWidth = Math.max(10, (d.sessions / maxSessions) * 360);
      svgChart += `
        <text x="10" y="${y + 16}" fill="#1a1a2e" font-size="12" font-weight="600">${esc(truncate(d.name, 22))}</text>
        <rect x="160" y="${y}" width="${barWidth}" height="20" rx="4" fill="${d.action === "improve" ? "#ea580c" : "#2563eb"}"></rect>
        <text x="${160 + barWidth + 10}" y="${y + 15}" fill="#667" font-size="11" font-weight="600">${d.sessions} ses (${d.events} ev)</text>
      `;
    });
  }
  svgChart += `</svg>`;

  const totalHarnessEvents = Object.values(harnessCounts).reduce((a, b) => a + b, 0) || 1;
  const harnessHtml = Object.entries(harnessCounts).sort((a,b) => b[1] - a[1]).map(([h, c]) => {
    const pct = Math.round((c / totalHarnessEvents) * 100);
    let color = "#2563eb";
    if (h === "claude-code") color = "#c026d3";
    if (h === "gemini") color = "#16a34a";
    if (h === "antigravity") color = "#ea580c";
    return `
      <div style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:600; margin-bottom:2px;">
          <span>${esc(h)}</span>
          <span>${c} events (${pct}%)</span>
        </div>
        <div style="width:100%; height:8px; background:#dde; border-radius:4px; overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:${color}; border-radius:4px;"></div>
        </div>
      </div>
    `;
  }).join("");

  const activeRowsHtml = activeList.map((stat) => {
    let badgeColor = "#16a34a";
    if (stat.action === "improve") badgeColor = "#ea580c";
    if (stat.action === "split or bundle review") badgeColor = "#9333ea";
    if (stat.action === "ignore-for-now") badgeColor = "#94a3b8";
    
    const actionBadge = `<span class="badge" style="background:${badgeColor}; color:#fff; font-weight:600; font-size:10px;">${esc(stat.action)}</span>`;
    const fSig = (stat.failures > 0 || stat.friction > 0)
      ? `<span style="color:#b91c1c; font-weight:600;">&#9888; ${stat.failures} fail, ${stat.friction} fric</span>`
      : `<span style="color:#16a34a;">clean</span>`;
      
    return `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:10px 16px; font-weight:600; font-size:13px;">${esc(stat.name)}</td>
        <td style="padding:10px 16px; text-align:center;">${stat.sessions}</td>
        <td style="padding:10px 16px; text-align:center;">${stat.events}</td>
        <td style="padding:10px 16px; font-size:11px; color:#556;">${esc(stat.harnesses)}</td>
        <td style="padding:10px 16px; text-align:center;">${fSig}</td>
        <td style="padding:10px 16px; text-align:center;">${actionBadge}</td>
      </tr>
    `;
  }).join("");

  const unusedHtml = unusedList.map((name) => `
    <span class="badge" style="background:#e2e8f0; color:#475569; margin:3px; display:inline-block; font-size:12px;">${esc(name)}</span>
  `).join("") || "_No unused skills detected._";

  const body = `
    <header style="padding:18px 24px 8px;">
      <h1>Skill Telemetry Insights</h1>
      ${nav("/telemetry", searchParams)}
      <div class="meta">Analyses of local event stream · unified cross-machine data</div>
    </header>

    <div class="chips" style="padding: 10px 24px; display:block;">
      <!-- Dashboard Stats cards -->
      <div style="display:flex; gap:16px; width:100%; flex-wrap:wrap; margin-bottom:20px;">
        <div style="flex:1; min-width:140px; background:#fff; padding:12px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.1); box-sizing:border-box;">
          <div style="font-size:10px; text-transform:uppercase; color:#667; font-weight:600; letter-spacing:.02em;">Raw Events</div>
          <div style="font-size:24px; font-weight:700; color:#1a1a2e; margin-top:4px;">${events.length}</div>
        </div>
        <div style="flex:1; min-width:140px; background:#fff; padding:12px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.1); box-sizing:border-box;">
          <div style="font-size:10px; text-transform:uppercase; color:#667; font-weight:600; letter-spacing:.02em;">Deduplicated</div>
          <div style="font-size:24px; font-weight:700; color:#1a1a2e; margin-top:4px;">${deduped.length}</div>
        </div>
        <div style="flex:1; min-width:140px; background:#fff; padding:12px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.1); box-sizing:border-box;">
          <div style="font-size:10px; text-transform:uppercase; color:#667; font-weight:600; letter-spacing:.02em;">Sessions Tracked</div>
          <div style="font-size:24px; font-weight:700; color:#1a1a2e; margin-top:4px;">${activeSessions.size}</div>
        </div>
        <div style="flex:1; min-width:140px; background:#fff; padding:12px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.1); box-sizing:border-box;">
          <div style="font-size:10px; text-transform:uppercase; color:#667; font-weight:600; letter-spacing:.02em;">Active Skills</div>
          <div style="font-size:24px; font-weight:700; color:#1a1a2e; margin-top:4px;">${activeSkills.size}</div>
        </div>
      </div>

      <!-- Charts & Visuals row -->
      <div style="display:flex; gap:16px; width:100%; flex-wrap:wrap; margin-bottom:20px; box-sizing:border-box;">
        <div style="flex:2; min-width:320px; box-sizing:border-box;">
          <h3 style="font-size:12px; text-transform:uppercase; margin:0 0 8px; color:#556; letter-spacing:.03em;">Top Skills Portfolio (by sessions)</h3>
          ${svgChart}
        </div>
        <div style="flex:1; min-width:240px; background:#fff; border-radius:8px; padding:16px; box-sizing:border-box; box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <h3 style="font-size:12px; text-transform:uppercase; margin:0 0 12px; color:#556; letter-spacing:.03em;">Harness Distribution</h3>
          ${harnessHtml}
        </div>
      </div>

      <!-- Active use Table -->
      <div style="width:100%; margin-bottom:20px;">
        <h3 style="font-size:12px; text-transform:uppercase; margin:0 0 8px; color:#556; letter-spacing:.03em;">Active Confirmed Usage Portfolio</h3>
        <div style="background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.1); width:100%;">
          <table style="width:100%; border-collapse:collapse; text-align:left; box-sizing:border-box;">
            <thead>
              <tr style="background:#f1f5f9; border-bottom:1px solid #e2e8f0; font-size:11px; text-transform:uppercase; color:#475569;">
                <th style="padding:10px 16px;">Skill Name</th>
                <th style="padding:10px 16px; text-align:center;">Sessions</th>
                <th style="padding:10px 16px; text-align:center;">Events</th>
                <th style="padding:10px 16px;">Harnesses</th>
                <th style="padding:10px 16px; text-align:center;">Friction</th>
                <th style="padding:10px 16px; text-align:center;">Suggested Action</th>
              </tr>
            </thead>
            <tbody>
              ${activeRowsHtml || `<tr><td colspan="6" style="padding:20px; text-align:center; color:#667;">No active skill usage detected yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Unused skills list -->
      <div style="width:100%; background:#fff; border-radius:8px; padding:16px; margin-bottom:20px; box-sizing:border-box; box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <h3 style="font-size:12px; text-transform:uppercase; margin:0 0 8px; color:#556; letter-spacing:.03em;">No Confirmed Active Use (${unusedList.length} skills)</h3>
        <p style="font-size:12px; color:#556; margin:0 0 10px;">These skills exist in the library but have not recorded active telemetry sessions. Consider for review or potential retirement.</p>
        <div style="max-height:160px; overflow-y:auto; padding:6px; border:1px solid #e2e8f0; border-radius:6px; background:#f8fafc;">
          ${unusedHtml}
        </div>
      </div>
    </div>
  `;
  return page("Skill Telemetry Insights", body);
}

function logServerVersion(outputDir, machine, repoRoot) {
  try {
    const pkgPath = path.join(repoRoot, "package.json");
    if (!fs.existsSync(pkgPath)) return;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const version = pkg.version;

    const machinesPath = path.join(outputDir, "machines.json");
    let data = {};
    if (fs.existsSync(machinesPath)) {
      try {
        let text = fs.readFileSync(machinesPath, "utf8");
        if (text.startsWith("\ufeff")) {
          text = text.slice(1);
        }
        data = JSON.parse(text);
      } catch (err) {}
    }

    if (!data[machine]) {
      data[machine] = { version, last_deployed: "", harnesses: {} };
    } else {
      data[machine].version = version;
    }
    
    data[machine].server = {
      version,
      last_run: new Date().toISOString()
    };
    
    fs.writeFileSync(machinesPath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`[version] Failed to log server version: ${err.message}`);
  }
}
