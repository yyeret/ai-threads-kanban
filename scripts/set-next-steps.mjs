#!/usr/bin/env node
// Merge suggested next-step prompts into the thread registry.
//   node set-next-steps.mjs --file next-steps.json
// The JSON is a flat map { "<thread_id>": "<next-step prompt>", ... }.
// next_step is preserved across rescans by reconcile-threads.mjs.

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
const stepsFile = args.file ? path.resolve(args.file) : path.join(dir, "next-steps.json");

if (!fs.existsSync(stepsFile)) {
  console.error(`Next-steps file not found: ${stepsFile}`);
  process.exit(1);
}
const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8"));

const records = readJsonl(registryPath);
if (!records.length) {
  console.error(`No registry at ${registryPath}.`);
  process.exit(1);
}

let applied = 0;
for (const r of records) {
  const s = steps[r.thread_id];
  if (s && typeof s === "string" && s.trim()) {
    r.next_step = s.trim();
    r.updated_at = new Date().toISOString();
    applied += 1;
  }
}
fs.writeFileSync(registryPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`Applied ${applied} next-step prompts to ${records.length} threads.`);

try {
  execFileSync(process.execPath, [path.join(scriptDir, "reconcile-threads.mjs")], { stdio: "ignore" });
  console.log("Board re-rendered.");
} catch {
  console.log("(Run reconcile-threads.mjs to re-render the board.)");
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

