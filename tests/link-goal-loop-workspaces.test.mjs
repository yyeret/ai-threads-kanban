import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { makeWorkspace, runScript } from "./helpers.mjs";

test("links the goal loop into supplied workspaces and excludes git noise", (t) => {
  const ws = makeWorkspace();
  t.after(() => fs.rmSync(ws.root, { recursive: true, force: true }));

  const businessWorkspace = path.join(ws.root, "CRM Ops");
  const gitWorkspace = path.join(ws.root, "yeret-agility-site");
  fs.mkdirSync(businessWorkspace, { recursive: true });
  fs.mkdirSync(gitWorkspace, { recursive: true });
  execFileSync("git", ["init"], { cwd: gitWorkspace, stdio: "ignore" });

  const stdout = runScript("link-goal-loop-workspaces.mjs", ws.env, [
    "--target",
    ws.registry,
    businessWorkspace,
    gitWorkspace,
  ]);

  assert.match(stdout, /linked: .*CRM Ops\/agent-goal-loop/);
  assert.match(stdout, /linked: .*yeret-agility-site\/agent-goal-loop/);
  assert.match(stdout, /linked: .*CRM Ops\/agent-goal-loop-profile\.md/);
  assert.match(stdout, /linked: .*yeret-agility-site\/agent-goal-loop-profile\.md/);
  assert.equal(fs.lstatSync(path.join(businessWorkspace, "agent-goal-loop")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(gitWorkspace, "agent-goal-loop")).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(gitWorkspace, "agent-goal-loop-profile.md")).isSymbolicLink(), true);
  assert.equal(path.resolve(gitWorkspace, fs.readlinkSync(path.join(gitWorkspace, "agent-goal-loop"))), ws.registry);
  const profilePath = path.resolve(gitWorkspace, fs.readlinkSync(path.join(gitWorkspace, "agent-goal-loop-profile.md")));
  assert.equal(path.basename(profilePath), "yeret-agility-site.md");
  assert.match(fs.readFileSync(profilePath, "utf8"), /Primary agent: Content Engine/);
  assert.match(fs.readFileSync(path.join(ws.registry, "workspace-profiles", "README.md"), "utf8"), /Agent Goal Loop Workspace Profiles/);

  const exclude = fs.readFileSync(path.join(gitWorkspace, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^agent-goal-loop$/m);
  assert.match(exclude, /^agent-goal-loop-profile\.md$/m);

  const secondRun = runScript("link-goal-loop-workspaces.mjs", ws.env, [
    "--target",
    ws.registry,
    businessWorkspace,
  ]);
  assert.match(secondRun, /already-linked: .*CRM Ops\/agent-goal-loop/);
  assert.match(secondRun, /already-linked: .*CRM Ops\/agent-goal-loop-profile\.md/);
});
