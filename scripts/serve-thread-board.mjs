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
import { spawn, execFileSync } from "node:child_process";
import { resolveRegistryDir } from "./lib/paths.mjs";

const home = os.homedir();
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || process.env.THREAD_BOARD_PORT || 7878);
const devMode = Boolean(args.dev || process.env.THREAD_BOARD_DEBUG || process.env.NODE_ENV === "development");
const dir = resolveRegistryDir();
const registryPath = path.join(dir, "active-threads.jsonl");
const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

// Kanban lanes, left to right. Funnel/Triage is the muted holding lane for
// already-started threads not yet clearly worth tracking; Done is muted at the
// far right; the middle is the committed Specify -> Review flow.
const STAGE_ORDER = [
  "Funnel / Triage", "On Hold", "Specify", "Plan", "Implement", "Review / Ship",
  "Done / Archive Candidates",
];
const LIST_ORDER = STAGE_ORDER;
const MUTED_STAGES = new Set(["Funnel / Triage", "On Hold", "Done / Archive Candidates"]);

// In-memory registry cache — loaded async at startup and on /refresh so
// request handlers never block on a Drive readFileSync that can stall
// indefinitely in a launchd (non-GUI) session.
let _registryCache = [];
async function reloadRegistryCache() {
  try {
    const text = await fs.promises.readFile(registryPath, "utf8");
    _registryCache = text.split(/\r?\n/).filter((l) => l.trim())
      .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
      .sort((a, b) => Date.parse(b.last_activity || 0) - Date.parse(a.last_activity || 0));
    if (devMode) console.log(`[cache] loaded ${_registryCache.length} threads`);
  } catch (err) {
    if (devMode) console.error(`[cache] load failed: ${err.message}`);
  }
}
reloadRegistryCache(); // warm the cache on startup; non-blocking

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/") return sendHtml(res, renderBoard(url.searchParams));
    if (url.pathname === "/kanban") return sendHtml(res, renderKanban(url.searchParams));
    if (url.pathname === "/telemetry") return sendHtml(res, renderTelemetry(url.searchParams));
    if (url.pathname === "/kanban-ipsum") return sendHtml(res, renderKanban(null, true));
    if (url.pathname === "/continue") return handleContinue(res, url.searchParams.get("id"), url.searchParams.get("step"));
    if (url.pathname === "/log") return handleLog(res, url.searchParams.get("id"));
    if (url.pathname === "/card") return handleCard(res, url.searchParams.get("id"));
    if (url.pathname === "/refresh") return handleRefresh(res);
    if (url.pathname === "/set-stage") return handleSetStage(res, url.searchParams.get("id"), url.searchParams.get("stage"));
    res.writeHead(404).end("Not found");
  } catch (err) {
    res.writeHead(500).end(`Error: ${err.message}`);
  }
});

server.listen(port, "127.0.0.1", () => {
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

function handleRefresh(res) {
  // Scan + reconcile only make sense when the process can reach the primary
  // registry (Drive). When running as a launchd agent the primary is
  // inaccessible; the local mirror is kept current by stop-hook refreshes.
  // We still try — if it fails the cached data stays valid.
  try {
    execFileSync(process.execPath, [path.join(scriptDir, "scan-session-history.mjs"), "--days", "30"], { stdio: "ignore" });
    execFileSync(process.execPath, [path.join(scriptDir, "reconcile-threads.mjs")], { stdio: "ignore" });
  } catch {
    /* ignore — board still serves the last good registry */
  }
  reloadRegistryCache(); // async, non-blocking
  res.writeHead(303, { Location: "/" }).end();
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
    .filter(([, value]) => value)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${basePath}?${query}` : basePath;
}

function filterThreads(all, { areaFilter, harnessFilter, machineFilter }) {
  return all.filter((t) => (
    (!areaFilter || t.intent_area === areaFilter)
    && (!harnessFilter || (t.harnesses || []).includes(harnessFilter))
    && (!machineFilter || (t.machines || []).includes(machineFilter))
  ));
}

function filterSummary(threads, { areaFilter, harnessFilter, machineFilter }) {
  const parts = [];
  if (areaFilter) parts.push(`in ${esc(areaFilter)}`);
  if (harnessFilter) parts.push(`via ${esc(harnessFilter)}`);
  if (machineFilter) parts.push(`on ${esc(machineFilter)}`);
  return `${threads.length} threads${parts.length ? ` ${parts.join(" ")}` : ""}`;
}

function areaChipBar(all, areaFilter, harnessFilter, machineFilter, basePath) {
  const areas = [...new Set(all.map((t) => t.intent_area || "Other / Unsorted"))].sort();
  const scoped = filterThreads(all, { harnessFilter, machineFilter });
  const q = (a) => queryPath(basePath, { area: a || "", harness: harnessFilter || "", machine: machineFilter || "" });
  return [
    `<a class="chip${areaFilter ? "" : " on"}" href="${q("")}">All areas (${scoped.length})</a>`,
    ...areas.map((a) => {
      const n = scoped.filter((t) => t.intent_area === a).length;
      return `<a class="chip${areaFilter === a ? " on" : ""}" href="${q(a)}">${esc(a)} (${n})</a>`;
    }),
  ].join("");
}

// Harness filter: a thread matches a harness if any of its sessions used it.
function harnessChipBar(all, harnessFilter, areaFilter, machineFilter, basePath) {
  const harnesses = [...new Set(all.flatMap((t) => t.harnesses || []))].sort();
  const scoped = filterThreads(all, { areaFilter, machineFilter });
  const q = (h) => queryPath(basePath, { area: areaFilter || "", harness: h || "", machine: machineFilter || "" });
  return [
    `<a class="chip${harnessFilter ? "" : " on"}" href="${q("")}">All harnesses (${scoped.length})</a>`,
    ...harnesses.map((h) => {
      const n = scoped.filter((t) => (t.harnesses || []).includes(h)).length;
      return `<a class="chip${harnessFilter === h ? " on" : ""}" href="${q(h)}">${esc(h)} (${n})</a>`;
    }),
  ].join("");
}

function machineChipBar(all, machineFilter, areaFilter, harnessFilter, basePath) {
  const machines = [...new Set(all.flatMap((t) => t.machines || []))].sort();
  const scoped = filterThreads(all, { areaFilter, harnessFilter });
  const q = (m) => queryPath(basePath, { area: areaFilter || "", harness: harnessFilter || "", machine: m || "" });
  return [
    `<a class="chip${machineFilter ? "" : " on"}" href="${q("")}">All machines (${scoped.length})</a>`,
    ...machines.map((m) => {
      const n = scoped.filter((t) => (t.machines || []).includes(m)).length;
      return `<a class="chip${machineFilter === m ? " on" : ""}" href="${q(m)}">${esc(m)} (${n})</a>`;
    }),
  ].join("");
}

function nav(active) {
  const link = (href, label) => `<a class="${active === href ? "navon" : ""}" href="${href}">${label}</a>`;
  return `<div class="nav">${link("/", "List view")} ${link("/kanban", "Kanban view")}
    ${link("/telemetry", "Telemetry Insights")}
    ${link("/kanban-ipsum", "Shareable")} ·
    <a href="/refresh">refresh now</a></div>`;
}

function renderBoard(searchParams) {
  const areaFilter = searchParams.get("area") || "";
  const harnessFilter = searchParams.get("harness") || "";
  const machineFilter = searchParams.get("machine") || "";
  const all = visibleThreads(loadRegistry());
  const threads = filterThreads(all, { areaFilter, harnessFilter, machineFilter });

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
      ${nav("/")}
      <div class="meta">${filterSummary(threads, { areaFilter, harnessFilter, machineFilter })} · auto-refreshes every 60s</div>
    </header>
    <div class="chips">${areaChipBar(all, areaFilter, harnessFilter, machineFilter, "/")}</div>
    <div class="chips chips-harness">${harnessChipBar(all, harnessFilter, areaFilter, machineFilter, "/")}</div>
    <div class="chips">${machineChipBar(all, machineFilter, areaFilter, harnessFilter, "/")}</div>
    ${sections || "<p>No threads.</p>"}
  `);
}

function renderKanban(searchParams, ipsum) {
  const areaFilter = ipsum ? "" : (searchParams.get("area") || "");
  const harnessFilter = ipsum ? "" : (searchParams.get("harness") || "");
  const machineFilter = ipsum ? "" : (searchParams.get("machine") || "");
  const all = visibleThreads(loadRegistry());
  const threads = ipsum ? all : filterThreads(all, { areaFilter, harnessFilter, machineFilter });

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
      return `
      <div class="mini${t.aging ? " mini-aging" : ""}${t.blocked ? " mini-blocked" : ""}${ipsum ? "" : " mini-open"}"${drag}
         style="border-left-color:${areaColor(t.intent_area)}" title="${tip}">
        <span class="mini-title">${esc(truncate(title, 90))}</span>
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
        ${nav("/kanban-ipsum")}
        <div class="meta">${threads.length} threads · card titles obfuscated — safe to screenshot</div>
      </header>
      <div class="board">${lanes}</div>
    `);
  }
  return page("AI Thread Board — Kanban", `
    <header>
      <h1>AI Thread Board — Kanban</h1>
      ${nav("/kanban")}
      <div class="meta">${filterSummary(threads, { areaFilter, harnessFilter, machineFilter })} ·
        drag a card to another lane to change its stage</div>
    </header>
    <div class="chips">${areaChipBar(all, areaFilter, harnessFilter, machineFilter, "/kanban")}</div>
    <div class="chips chips-harness">${harnessChipBar(all, harnessFilter, areaFilter, machineFilter, "/kanban")}</div>
    <div class="chips">${machineChipBar(all, machineFilter, areaFilter, harnessFilter, "/kanban")}</div>
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
    
  const titleText = isMaint ? `&#128736; ${esc(t.title)}` : esc(t.display_title || t.title);
  
  return `
    <div class="card${t.aging ? " is-aging" : ""}" id="t-${t.thread_id}">
      <div class="card-head">
        <span class="title">${titleText}</span>${blocked}${aging}
        <span class="badge area">${esc(t.intent_area || "Other / Unsorted")}</span>
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

function findThread(id) {
  if (!id) return null;
  return loadRegistry().find((t) => t.thread_id === id) || null;
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
  .blk { background: #b91c1c; color: #fff; font-weight: 700; font-size: 9px; padding: 1px 4px; border-radius: 3px; }
  .badge.blocked { background: #b91c1c; color: #fff; font-weight: 700; font-size: 11px; padding: 2px 8px; }
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
</style></head><body>${body}</body></html>`;
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
      ${nav("/telemetry")}
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

