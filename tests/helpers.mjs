// Test helpers for the AI Thread Board scripts. These tests are
// integration-style: each test builds a temporary HOME + registry, drives
// the real script as a child process, and inspects the resulting files.
// Subprocess testing matches how the scripts are actually used and avoids
// having to refactor the scripts into importable libraries.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");
export const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts");

// Make a unique tmp directory for one test. The caller is responsible for
// cleanup via t.after(() => fs.rmSync(dir, { recursive: true, force: true })).
export function makeTmpDir(prefix = "thread-board-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Build a fake HOME with empty .codex/.claude/.gemini scaffolding, plus a
// separate registry dir. Returns the env to pass to the child process.
export function makeWorkspace() {
  const root = makeTmpDir();
  const home = path.join(root, "home");
  const memory = path.join(root, "memory");
  const registry = path.join(memory, "projects", "agent-threads");
  fs.mkdirSync(path.join(home, ".codex", "sessions"), { recursive: true });
  fs.mkdirSync(path.join(home, ".codex", "archived_sessions"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  fs.mkdirSync(path.join(home, ".gemini"), { recursive: true });
  fs.mkdirSync(registry, { recursive: true });
  return {
    root,
    home,
    registry,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      AGENT_THREADS_OUTPUT_DIR: registry,
      AI_AGENT_MEMORY_ROOT: memory,
      AGENT_MEMORY_ROOT: memory,
    },
  };
}

// Run a thread-board script with the supplied env. Returns stdout (utf8).
// stderr is left on the inherited fd so test failures surface real errors.
export function runScript(scriptName, env, args = []) {
  return execFileSync(process.execPath, [path.join(SCRIPTS_DIR, scriptName), ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function writeJsonl(file, records) {
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

// Write one fake Codex rollout file and a matching session_index entry.
// Returns the session_id so tests can assert on it.
export function seedCodexSession(home, {
  id,
  cwd = "/tmp",
  threadName = "throwaway",
  prompt = "test prompt",
  date = "2026-05-22",
}) {
  const [y, m, d] = date.split("-");
  const dir = path.join(home, ".codex", "sessions", y, m, d);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-${date}T10-00-00-${id}.jsonl`);
  const turns = [
    { type: "session_meta", payload: { id, cwd, originator: "vscode" } },
    { type: "event_msg", payload: { type: "user_message", message: prompt } },
    { type: "event_msg", payload: { type: "agent_message", message: "Acknowledged." } },
  ];
  fs.writeFileSync(file, turns.map((t) => JSON.stringify({ timestamp: `${date}T10:00:00Z`, ...t })).join("\n") + "\n");

  const indexPath = path.join(home, ".codex", "session_index.jsonl");
  const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : "";
  fs.writeFileSync(indexPath, existing + JSON.stringify({ id, thread_name: threadName, updated_at: `${date}T10:00:00Z` }) + "\n");

  return { id, rolloutPath: file };
}

// Minimal valid registry record. Tests override the fields they care about.
export function makeThreadRecord(overrides = {}) {
  const now = new Date().toISOString();
  return {
    thread_id: "abc123",
    repo_key: "repo",
    intent_hash: "intent",
    title: "Test thread",
    display_title: "",
    next_step: "",
    intent_area: "Other",
    harnesses: ["Codex"],
    machines: [os.hostname()],
    session_count: 1,
    sessions: [],
    inferred_stage: "Specify",
    manual_stage: null,
    stage: "Specify",
    stage_changed_at: now,
    blocked: false,
    status: "active",
    tracking_decision: "track",
    where_it_stands: "",
    first_seen: now,
    last_activity: now,
    total_tool_count: 0,
    staleness_hours: 0,
    aging: false,
    dropped_from_scan: false,
    notes: "",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
