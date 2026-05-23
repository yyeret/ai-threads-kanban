#!/usr/bin/env node
// Apply a manual nudge to a thread in the registry. Manual fields survive
// every rescan (reconcile-threads.mjs preserves them), so this is how a
// human corrects a misclassified thread or marks one finished.
//
// Usage:
//   node edit-thread.mjs --match "<thread_id prefix or title substring>" [opts]
//   node edit-thread.mjs --here [opts]   target the thread of the current session
//   --stage "<stage>"   set manual_stage (overrides the inferred stage)
//   --status "<text>"   set manual_status
//   --track             force tracking_decision = track
//   --area "<text>"     set the intent-area tag
//   --finish            mark Done: stage=Done/Archive, tracking=archive
//   --note "<text>"     set/replace the notes field
//   --list              just list current threads (no change)
//
// --here resolves "this thread" by scanning native harness history first
// (so a brand-new thread gets registered), then picking the thread whose
// most recent session ran in the current working directory.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveRegistryDir } from "./lib/paths.mjs";

const home = os.homedir();
const args = parseArgs(process.argv.slice(2));
const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = resolveRegistryDir();
const registryPath = path.join(dir, "active-threads.jsonl");

const STAGES = [
  "Funnel / Triage", "On Hold", "Specify", "Plan", "Implement",
  "Review / Ship", "Done / Archive Candidates",
];

let records = readJsonl(registryPath);
if (!records.length && !args.here) {
  console.error(`No registry at ${registryPath}. Run scan-session-history.mjs + reconcile-threads.mjs first.`);
  process.exit(1);
}

let target;
if (args.here) {
  // Scan native history so a not-yet-registered thread shows up, then
  // pick the thread whose freshest session ran in this directory.
  refreshRegistry();
  records = readJsonl(registryPath);
  const cwd = path.resolve(process.cwd()).toLowerCase();
  const here = records
    .map((r) => ({ r, ts: cwdActivity(r, cwd) }))
    .filter((x) => x.ts > 0)
    .sort((a, b) => b.ts - a.ts);
  if (!here.length) {
    console.error(`No thread found for the current directory:\n  ${process.cwd()}`);
    console.error("The session may not be scanned yet — try again after a turn or two.");
    process.exit(1);
  }
  target = here[0].r;
}

if (!args.here && (args.list || !args.match)) {
  for (const r of records.sort((a, b) => Date.parse(b.last_activity || 0) - Date.parse(a.last_activity || 0))) {
    console.log(`  ${r.thread_id}  [${r.stage}]  ${r.title}`);
  }
  if (!args.match) {
    console.log("\nPass --match \"<thread_id prefix or title substring>\" plus an action.");
  }
  process.exit(0);
}

if (!args.here) {
  const needle = String(args.match).toLowerCase();
  const matches = records.filter(
    (r) => r.thread_id.startsWith(needle) || r.title.toLowerCase().includes(needle),
  );
  if (matches.length === 0) {
    console.error(`No thread matches "${args.match}".`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`"${args.match}" is ambiguous — ${matches.length} threads match:`);
    for (const r of matches) console.error(`  ${r.thread_id}  ${r.title}`);
    console.error("Re-run with a longer thread_id prefix.");
    process.exit(1);
  }
  target = matches[0];
}

const changes = [];

if (args.stage) {
  const stage = resolveStage(args.stage);
  if (!stage) {
    console.error(`Unknown stage "${args.stage}". Valid: ${STAGES.join(", ")}`);
    process.exit(1);
  }
  target.manual_stage = stage;
  target.stage_changed_at = new Date().toISOString();
  changes.push(`manual_stage -> ${stage}`);
  if (stage === "Done / Archive Candidates") {
    target.manual_tracking = "archive";
    target.manual_status = "done";
    changes.push("marked finished (tracking -> archive)");
  }
}
if (args.finish) {
  target.manual_stage = "Done / Archive Candidates";
  target.manual_tracking = "archive";
  target.manual_status = "done";
  target.stage_changed_at = new Date().toISOString();
  changes.push("marked finished (Done / archive)");
}
if (args.track) {
  target.manual_tracking = "track";
  changes.push("manual_tracking -> track");
}
if (args.area && args.area !== true) {
  target.manual_area = String(args.area);
  target.intent_area = String(args.area);
  changes.push(`intent_area -> ${args.area}`);
}
if (args.status) {
  target.manual_status = String(args.status);
  changes.push(`manual_status -> ${args.status}`);
}
if (args.note !== undefined) {
  // `--note` with no value clears the note.
  target.notes = args.note === true ? "" : String(args.note);
  changes.push(target.notes ? `notes -> ${truncate(target.notes, 60)}` : "notes cleared");
}

if (!changes.length) {
  console.error("No action given. Use --stage / --finish / --track / --status / --note.");
  process.exit(1);
}

target.updated_at = new Date().toISOString();
fs.writeFileSync(registryPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`Updated thread ${target.thread_id} — ${target.title}`);
for (const c of changes) console.log(`  ${c}`);

// Re-render the board so active-threads.md reflects the nudge immediately.
try {
  const node = process.execPath;
  execFileSync(node, [path.join(scriptDir, "reconcile-threads.mjs")], { stdio: "ignore" });
  console.log("Board re-rendered.");
} catch {
  console.log("(Run reconcile-threads.mjs to re-render the board.)");
}

// Newest session activity for `record` whose cwd matches `cwd` (0 = no match).
function cwdActivity(record, cwd) {
  let best = 0;
  for (const s of record.sessions || []) {
    if (!s.cwd) continue;
    if (path.resolve(s.cwd).toLowerCase() !== cwd) continue;
    const ts = Date.parse(s.last_activity || record.last_activity || 0) || 0;
    if (ts > best) best = ts;
  }
  return best;
}

// Scan native harness history + reconcile so the registry is current.
function refreshRegistry() {
  const node = process.execPath;
  for (const step of ["scan-session-history.mjs", "reconcile-threads.mjs"]) {
    try {
      execFileSync(node, [path.join(scriptDir, step)], { stdio: "ignore" });
    } catch {
      // Best-effort — fall back to whatever registry already exists.
    }
  }
}

function resolveStage(input) {
  const want = String(input).toLowerCase();
  return STAGES.find((s) => s.toLowerCase() === want)
    || STAGES.find((s) => s.toLowerCase().startsWith(want))
    || STAGES.find((s) => s.toLowerCase().includes(want))
    || null;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const hasValue = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--");
      out[key] = hasValue ? argv[++i] : true;
    }
  }
  return out;
}

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function truncate(text, n) {
  return text.length > n ? `${text.slice(0, n - 3)}...` : text;
}

