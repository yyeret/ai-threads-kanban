#!/usr/bin/env node
// Merge outcome-framed display titles into the thread registry.
//   node set-display-titles.mjs --file display-titles.json
// The JSON is a flat map { "<thread_id>": "<display title>", ... }.
// display_title is preserved across rescans by reconcile-threads.mjs.

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
const titlesFile = args.file ? path.resolve(args.file) : path.join(dir, "display-titles.json");

if (!fs.existsSync(titlesFile)) {
  console.error(`Titles file not found: ${titlesFile}`);
  process.exit(1);
}
const titles = JSON.parse(fs.readFileSync(titlesFile, "utf8"));

const records = readJsonl(registryPath);
if (!records.length) {
  console.error(`No registry at ${registryPath}.`);
  process.exit(1);
}

let applied = 0;
for (const r of records) {
  const t = titles[r.thread_id];
  if (t && typeof t === "string" && t.trim()) {
    r.display_title = t.trim();
    r.updated_at = new Date().toISOString();
    applied += 1;
  }
}
fs.writeFileSync(registryPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`Applied ${applied} display titles to ${records.length} threads.`);

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

