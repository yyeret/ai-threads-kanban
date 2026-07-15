import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { makeWorkspace, readJsonl, writeJsonl, makeThreadRecord, SCRIPTS_DIR } from "./helpers.mjs";

test("server lets uncategorized cards set a durable goal network override", async (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  writeJsonl(path.join(ws.registry, "active-threads.jsonl"), [
    makeThreadRecord({
      thread_id: "uncat01",
      title: "Uncategorized goal",
      intent_area: "Other / Unsorted",
      stage: "Specify",
    }),
    makeThreadRecord({
      thread_id: "known01",
      title: "Known goal",
      intent_area: "Content & Publishing",
      stage: "Specify",
    }),
  ]);

  const port = await startServer(t, ws.env);
  const html = await fetchText(`http://127.0.0.1:${port}/kanban`);
  assert.match(html, /Goal network/);
  assert.equal((html.match(/action="\/set-goal-network"/g) || []).length, 1);

  const params = new URLSearchParams({ id: "uncat01", network: "Content & Publishing" });
  const res = await fetch(`http://127.0.0.1:${port}/set-goal-network?${params}`, {
    headers: { Accept: "text/plain" },
  });
  assert.equal(res.status, 200);

  const out = readJsonl(path.join(ws.registry, "active-threads.jsonl"));
  const updated = out.find((r) => r.thread_id === "uncat01");
  assert.equal(updated.manual_area, "Content & Publishing");
  assert.equal(updated.intent_area, "Content & Publishing");
});

async function startServer(t, env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
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
