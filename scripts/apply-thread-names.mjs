#!/usr/bin/env node
// Stamp "[Stage] display title" onto native harness session names so threads
// show their lifecycle stage and intent in harness session pickers.
//
// Codex: rewrites thread_name in ~/.codex/session_index.jsonl. Idempotent —
// the name is fully recomputed each run, so stage changes track automatically.
// Only sessions present in the LOCAL index are touched (cross-machine safe).
//
// Also archives finished Codex threads: any thread whose manual_status="done"
// has its sessions removed from session_index.jsonl, hiding them from the
// Codex resume picker. Transcripts on disk are untouched; resuming the
// session re-adds the entry.
//
// Claude Code: renaming sessions in the picker is not feasible. The picker
// builds labels from the first user message in each project session JSONL;
// there is no separate title field to write. (~/.claude/history.jsonl is
// prompt history, not a session-title store.)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRegistryDir } from "./lib/paths.mjs";

const home = os.homedir();
const args = parseArgs(process.argv.slice(2));
const dir = resolveRegistryDir();
const registryPath = path.join(dir, "active-threads.jsonl");

const STAGE_SHORT = {
  "Funnel / Triage": "Funnel",
  "On Hold": "On Hold",
  "Specify": "Specify",
  "Plan": "Plan",
  "Implement": "Implement",
  "Review / Ship": "Review",
  "Done / Archive Candidates": "Done",
};

const records = readJsonl(registryPath);
if (!records.length) {
  console.error(`No registry at ${registryPath}.`);
  process.exit(1);
}

// codexNames: id -> "[Stage] title" rewrite for live sessions.
// codexArchive: id -> transcript_path (or null) for sessions whose thread is
// manually finished. Archive mirrors Codex's native archive: move the rollout
// file to ~/.codex/archived_sessions/ and drop the line from session_index.
const codexNames = new Map();
const codexArchive = new Map();
for (const r of records) {
  // A blocked thread shows "[Blocked]" — the most action-relevant label in a
  // flat picker list; otherwise the flow stage.
  const tag = r.blocked ? "Blocked" : (STAGE_SHORT[r.stage] || "Thread");
  const label = `[${tag}] ${stripPrefix(r.display_title || r.title || "Untitled")}`;
  const inDoneStage = r.manual_stage === "Done / Archive Candidates"
    || r.stage === "Done / Archive Candidates";
  // Default: only archive when the user has explicitly marked the thread done.
  // --archive-done-stage: one-shot override for cleanup — archive anything
  // currently sitting in the Done lane regardless of manual_status.
  const finished = args["archive-done-stage"]
    ? inDoneStage
    : (r.manual_status === "done" && inDoneStage);
  for (const s of r.sessions || []) {
    if (s.harness === "Codex" && s.session_id) {
      if (finished) codexArchive.set(s.session_id, s.transcript_path || null);
      else codexNames.set(s.session_id, label);
    }
  }
}

const moved = moveCodexRollouts(codexArchive);
const { renamed, archived } = updateCodex(codexNames, codexArchive);
console.log(`Codex: renamed ${renamed}, archived ${archived} from index, moved ${moved} rollout file(s).`);

// --- Codex -----------------------------------------------------------------

// One pass over session_index.jsonl: drop lines whose id is in `archive`,
// rewrite thread_name for ids in `names`. Atomic write.
function updateCodex(names, archive) {
  const indexPath = path.join(home, ".codex", "session_index.jsonl");
  if (!fs.existsSync(indexPath)) return { renamed: 0, archived: 0 };
  let renamed = 0;
  let archived = 0;
  const out = [];
  for (const line of fs.readFileSync(indexPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) { out.push(line); continue; }
    let obj;
    try { obj = JSON.parse(line); } catch { out.push(line); continue; }
    if (archive.has(obj.id)) { archived += 1; continue; }
    const want = names.get(obj.id);
    if (want && obj.thread_name !== want) {
      obj.thread_name = want;
      renamed += 1;
      out.push(JSON.stringify(obj));
    } else {
      out.push(line);
    }
  }
  if (renamed || archived) writeAtomic(indexPath, out.join("\n"));
  return { renamed, archived };
}

// Move each rollout file under ~/.codex/sessions/... to ~/.codex/archived_sessions/.
// Cross-machine safe: only files that actually exist locally are moved. The
// registry is shared across machines, so this loop is a no-op for sessions
// owned by a different machine.
function moveCodexRollouts(archive) {
  if (archive.size === 0) return 0;
  const archiveDir = path.join(home, ".codex", "archived_sessions");
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
  let moved = 0;
  for (const src of archive.values()) {
    if (!src || !fs.existsSync(src)) continue;
    const dest = path.join(archiveDir, path.basename(src));
    if (fs.existsSync(dest)) continue;
    try { fs.renameSync(src, dest); moved += 1; }
    catch { /* best-effort */ }
  }
  return moved;
}

// --- helpers ---------------------------------------------------------------

// Drop a leading "[Stage] " so re-application never compounds prefixes.
function stripPrefix(text) {
  return String(text || "").replace(/^\s*\[[^\]]{1,24}\]\s*/, "").trim();
}

function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
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

function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

