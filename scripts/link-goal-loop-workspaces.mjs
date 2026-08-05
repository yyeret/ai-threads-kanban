#!/usr/bin/env node
// Put a stable symlink to the shared goal-loop registry inside related
// workspaces, so agents can find current goal state from the workspace they
// are already operating in.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const linkName = args["link-name"] || "agent-goal-loop";
const profileLinkName = args["profile-link-name"] || "agent-goal-loop-profile.md";
const target = path.resolve(args.target ? expandHome(args.target) : resolveGoalLoopTarget());
const workspaces = args._.length
  ? args._.map((item) => workspaceEntry(path.resolve(expandHome(item))))
  : defaultWorkspaces();

if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  console.error(`Goal-loop target does not exist or is not a directory: ${target}`);
  process.exit(1);
}

const profileDir = path.join(target, "workspace-profiles");
fs.mkdirSync(profileDir, { recursive: true });
writeProfileIndex(profileDir, workspaces);

const results = [];
for (const entry of workspaces) {
  const { workspace } = entry;
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    results.push({ workspace, status: "missing" });
    continue;
  }
  const loopResult = ensureSymlink({
    workspace,
    linkPath: path.join(workspace, linkName),
    targetPath: target,
    type: "dir",
    force: args.force,
  });
  results.push(loopResult);

  const profilePath = path.join(profileDir, `${entry.slug}.md`);
  fs.writeFileSync(profilePath, renderProfile(entry), "utf8");
  const profileResult = ensureSymlink({
    workspace,
    linkPath: path.join(workspace, profileLinkName),
    targetPath: profilePath,
    type: "file",
    force: args.force,
  });
  results.push(profileResult);

  excludeFromGit(workspace, linkName);
  excludeFromGit(workspace, profileLinkName);
}

for (const result of results) {
  const suffix = result.detail ? ` (${result.detail})` : "";
  console.log(`${result.status}: ${result.linkPath || path.join(result.workspace, linkName)}${suffix}`);
}

function resolveGoalLoopTarget() {
  const configPath = path.join(os.homedir(), ".config", "ai-threads-kanban", "registry-root");
  if (fs.existsSync(configPath)) {
    const configured = fs.readFileSync(configPath, "utf8").trim();
    if (configured) return configured;
  }
  const memoryRoot = process.env.AI_AGENT_MEMORY_ROOT || process.env.AGENT_MEMORY_ROOT;
  if (memoryRoot) return path.join(memoryRoot, "projects", "agent-threads");
  return path.join(os.homedir(), ".local", "share", "ai-threads-kanban");
}

function defaultWorkspaces() {
  const home = os.homedir();
  const workOnBusiness = path.join(
    home,
    "Library",
    "CloudStorage",
    "GoogleDrive-yuval@yeretagility.com",
    "My Drive",
    "Yeret Agility",
    "Agility",
    "Work ON the Business",
  );
  return [
    workspaceEntry(path.join(workOnBusiness, "CRM Ops"), {
      slug: "crm-ops",
      label: "CRM Ops",
      primaryAgent: "Revenue",
      primaryAgentFile: "agents/revenue.md",
      secondaryAgents: ["GTM Strategist", "Gatekeeper"],
      goalIds: ["revenue-pipeline-outreach"],
      cadence: "daily or weekly pipeline tick",
      focus: [
        "advance real relationships and live opportunities",
        "separate SDR prospecting from BDR nurture before recommending action",
        "keep CRM state, next touch windows, and relationship context observable",
      ],
      style: [
        "recipient-first and specific",
        "commercially direct without sounding automated",
        "skeptical of generic nudge text or invented prospect data",
      ],
      guardrails: [
        "do not send email, DMs, or CRM mutations without Yuval approval",
        "do not invent LinkedIn URLs, relationship history, or deal facts",
        "surface high-stakes relationships for review rather than auto-touching them",
      ],
    }),
    workspaceEntry(path.join(workOnBusiness, "AI Transformation Consulting"), {
      slug: "ai-transformation-consulting",
      label: "AI Transformation Consulting",
      primaryAgent: "Delivery Coach",
      primaryAgentFile: "agents/delivery-coach.md",
      secondaryAgents: ["GTM Strategist", "Content Engine", "Gatekeeper"],
      goalIds: ["ai-native-delivery-systems", "gtm-strategy-positioning"],
      cadence: "weekly IP and positioning tick",
      focus: [
        "turn AI-era delivery practice into reusable coaching IP",
        "separate client-facing method from GTM narrative and public content",
        "look for evidence that leaders can adapt delivery systems for AI-native work",
      ],
      style: [
        "pragmatic delivery-coaching voice",
        "outcomes over AI theater or framework worship",
        "challenge vague transformation language and ask what changed in the operating system",
      ],
      guardrails: [
        "do not publish or externalize client-sensitive material",
        "route offer/category implications to GTM Strategist",
        "route outward artifacts through Gatekeeper before shipping",
      ],
    }),
    workspaceEntry(path.join(workOnBusiness, "Marketing Engine"), {
      slug: "marketing-engine",
      label: "Marketing Engine",
      primaryAgent: "Content Engine",
      primaryAgentFile: "agents/content-engine.md",
      secondaryAgents: ["GTM Strategist", "Gatekeeper"],
      goalIds: ["marketing-discoverability", "gtm-strategy-positioning"],
      cadence: "weekly visibility and content tick",
      focus: [
        "increase discoverability with useful, audience-fit content",
        "turn existing IP into shippable assets before creating net-new sprawl",
        "connect content work to a visible next distribution or learning step",
      ],
      style: [
        "Yuval-voice, direct, concrete, and non-hype",
        "editorial judgment before volume",
        "prefer mixed-format reuse when it helps the audience",
      ],
      guardrails: [
        "do not publish or schedule externally without approval",
        "do not take a new strategic stance without GTM review",
        "do not let analytics work become a vanity-metric detour",
      ],
    }),
    workspaceEntry(path.join(home, "Github", "yeret-agility-site"), {
      slug: "yeret-agility-site",
      label: "yeret-agility-site",
      primaryAgent: "Content Engine",
      primaryAgentFile: "agents/content-engine.md",
      secondaryAgents: ["AI Operator", "Gatekeeper", "GTM Strategist"],
      goalIds: ["marketing-discoverability", "website-developer", "ai-native-delivery-systems"],
      cadence: "content or site-health tick",
      focus: [
        "treat C-SDD/content-SDD and backlog content as content first, not website engineering",
        "keep site mechanics in Website Developer only when the work is implementation, build, layout, routing, or deployment",
        "verify public-facing work with a live preview before handing it back",
      ],
      style: [
        "editorial and product-minded",
        "AI-first positioning without generic AI hype",
        "strict about voice, proof, and rendered experience",
      ],
      guardrails: [
        "do not collapse AI-native delivery content into Website Developer just because it lives in the site repo",
        "do not ship public changes without preview verification",
        "route positioning changes to GTM Strategist and quality calls to Gatekeeper",
      ],
    }),
    workspaceEntry(path.join(home, "Github", "ai-skill-library"), {
      slug: "ai-skill-library",
      label: "ai-skill-library",
      primaryAgent: "AI Operator",
      primaryAgentFile: "agents/ai-operator.md",
      secondaryAgents: ["Gatekeeper"],
      goalIds: ["internal-ai-operating-system"],
      cadence: "weekly operating-system hygiene tick",
      focus: [
        "improve reusable skills, routing, setup scripts, and memory discipline",
        "turn repeated friction into durable code, docs, tests, or skill updates",
        "keep Mac, Windows, Codex, Claude, Gemini, and Cline paths in view",
      ],
      style: [
        "systems operator, compact and evidence-driven",
        "prefer file-backed, inspectable state over hidden memory",
        "conservative about adding abstraction",
      ],
      guardrails: [
        "do not change instruction semantics without Yuval approval",
        "always log skill usage when loading or using a skill",
        "verify generated/local instruction drift when behavior matters",
      ],
    }),
    workspaceEntry(path.join(home, "Github", "ai-threads-kanban"), {
      slug: "ai-threads-kanban",
      label: "ai-threads-kanban",
      primaryAgent: "AI Operator",
      primaryAgentFile: "agents/ai-operator.md",
      secondaryAgents: ["Chief of Staff"],
      goalIds: ["internal-ai-operating-system", "chief-of-staff-operations"],
      cadence: "weekly goal-loop and dashboard hygiene tick",
      focus: [
        "keep the shared goal loop observable, correctable, and visible on the board",
        "preserve reviewed goal/thread overrides while improving deterministic heuristics",
        "make loop state available across workspaces without duplicating state",
      ],
      style: [
        "toolsmith and operator",
        "deterministic first, agentic enrichment second",
        "careful about registry-path drift and local/shared mirrors",
      ],
      guardrails: [
        "do not silently move mixed-signal thread assignments",
        "revalidate which registry the board is reading before trusting counts",
        "run tests for extractor, reviewer, server, and linker changes",
      ],
    }),
  ];
}

function workspaceEntry(workspace, overrides = {}) {
  const inferred = inferWorkspaceOverrides(workspace);
  overrides = { ...inferred, ...overrides };
  const label = overrides.label || path.basename(workspace);
  return {
    workspace,
    slug: overrides.slug || slugify(label),
    label,
    primaryAgent: overrides.primaryAgent || "Chief of Staff",
    primaryAgentFile: overrides.primaryAgentFile || "agents/chief-of-staff.md",
    secondaryAgents: overrides.secondaryAgents || [],
    goalIds: overrides.goalIds || [],
    cadence: overrides.cadence || "ad hoc workspace tick",
    focus: overrides.focus || ["orient to this workspace and surface the next useful move"],
    style: overrides.style || ["use the shared Yuval voice and this workspace's local conventions"],
    guardrails: overrides.guardrails || ["do not mutate external systems without explicit approval"],
  };
}

function inferWorkspaceOverrides(workspace) {
  const normalized = workspace.toLowerCase();
  if (/(^|[\\/])crm ops$|crm-ops/.test(normalized)) {
    return {
      slug: "crm-ops",
      label: "CRM Ops",
      primaryAgent: "Revenue",
      primaryAgentFile: "agents/revenue.md",
      secondaryAgents: ["GTM Strategist", "Gatekeeper"],
      goalIds: ["revenue-pipeline-outreach"],
      cadence: "daily or weekly pipeline tick",
      focus: ["advance real relationships and live opportunities"],
      style: ["recipient-first and specific"],
      guardrails: ["do not send email, DMs, or CRM mutations without Yuval approval"],
    };
  }
  if (/(^|[\\/])ai transformation consulting$|ai-transformation-consulting/.test(normalized)) {
    return {
      slug: "ai-transformation-consulting",
      label: "AI Transformation Consulting",
      primaryAgent: "Delivery Coach",
      primaryAgentFile: "agents/delivery-coach.md",
      secondaryAgents: ["GTM Strategist", "Content Engine", "Gatekeeper"],
      goalIds: ["ai-native-delivery-systems", "gtm-strategy-positioning"],
      cadence: "weekly IP and positioning tick",
      focus: ["turn AI-era delivery practice into reusable coaching IP"],
      style: ["pragmatic delivery-coaching voice"],
      guardrails: ["do not publish or externalize client-sensitive material"],
    };
  }
  if (/(^|[\\/])marketing engine$|marketing-engine/.test(normalized)) {
    return {
      slug: "marketing-engine",
      label: "Marketing Engine",
      primaryAgent: "Content Engine",
      primaryAgentFile: "agents/content-engine.md",
      secondaryAgents: ["GTM Strategist", "Gatekeeper"],
      goalIds: ["marketing-discoverability", "gtm-strategy-positioning"],
      cadence: "weekly visibility and content tick",
      focus: ["increase discoverability with useful, audience-fit content"],
      style: ["Yuval-voice, direct, concrete, and non-hype"],
      guardrails: ["do not publish or schedule externally without approval"],
    };
  }
  if (/yeret-agility-site/.test(normalized)) {
    return {
      slug: "yeret-agility-site",
      label: "yeret-agility-site",
      primaryAgent: "Content Engine",
      primaryAgentFile: "agents/content-engine.md",
      secondaryAgents: ["AI Operator", "Gatekeeper", "GTM Strategist"],
      goalIds: ["marketing-discoverability", "website-developer", "ai-native-delivery-systems"],
      cadence: "content or site-health tick",
      focus: ["treat C-SDD/content-SDD and backlog content as content first, not website engineering"],
      style: ["editorial and product-minded"],
      guardrails: ["do not collapse AI-native delivery content into Website Developer just because it lives in the site repo"],
    };
  }
  if (/ai-skill-library/.test(normalized)) {
    return {
      slug: "ai-skill-library",
      label: "ai-skill-library",
      primaryAgent: "AI Operator",
      primaryAgentFile: "agents/ai-operator.md",
      secondaryAgents: ["Gatekeeper"],
      goalIds: ["internal-ai-operating-system"],
      cadence: "weekly operating-system hygiene tick",
      focus: ["improve reusable skills, routing, setup scripts, and memory discipline"],
      style: ["systems operator, compact and evidence-driven"],
      guardrails: ["do not change instruction semantics without Yuval approval"],
    };
  }
  if (/ai-threads-kanban/.test(normalized)) {
    return {
      slug: "ai-threads-kanban",
      label: "ai-threads-kanban",
      primaryAgent: "AI Operator",
      primaryAgentFile: "agents/ai-operator.md",
      secondaryAgents: ["Chief of Staff"],
      goalIds: ["internal-ai-operating-system", "chief-of-staff-operations"],
      cadence: "weekly goal-loop and dashboard hygiene tick",
      focus: ["keep the shared goal loop observable, correctable, and visible on the board"],
      style: ["toolsmith and operator"],
      guardrails: ["do not silently move mixed-signal thread assignments"],
    };
  }
  return {};
}

function ensureSymlink({ workspace, linkPath, targetPath, type, force }) {
  if (fs.existsSync(linkPath) || isBrokenSymlink(linkPath)) {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) {
      return { workspace, linkPath, status: "blocked", detail: "path exists and is not a symlink" };
    }
    const current = path.resolve(workspace, fs.readlinkSync(linkPath));
    if (current !== targetPath) {
      if (!force) return { workspace, linkPath, status: "blocked", detail: `symlink points to ${current}` };
      fs.unlinkSync(linkPath);
      fs.symlinkSync(targetPath, linkPath, type);
      return { workspace, linkPath, status: "updated" };
    }
    return { workspace, linkPath, status: "already-linked" };
  }
  fs.symlinkSync(targetPath, linkPath, type);
  return { workspace, linkPath, status: "linked" };
}

function renderProfile(entry) {
  const secondary = entry.secondaryAgents.length ? entry.secondaryAgents.join(", ") : "none";
  const goals = entry.goalIds.length ? entry.goalIds.map((id) => `\`${id}\``).join(", ") : "discover from `agent-goal-loop/goal-network.json`";
  return `# Agent Goal Loop Profile - ${entry.label}

This profile specializes the shared goal loop for this workspace. Use it after
loading the shared identity pack and the primary agent file.

## Agent Environment

- Workspace: \`${entry.workspace}\`
- Shared loop: \`agent-goal-loop/\`
- Primary agent: ${entry.primaryAgent} (\`${entry.primaryAgentFile}\`)
- Secondary agents: ${secondary}
- Owned / watched goals: ${goals}
- Cadence: ${entry.cadence}

## Personality / Focus

${entry.focus.map((item) => `- ${item}`).join("\n")}

## Operating Style

${entry.style.map((item) => `- ${item}`).join("\n")}

## Guardrails

${entry.guardrails.map((item) => `- ${item}`).join("\n")}

## Loop Instructions

1. BOOT from the shared agent memory: read \`SOUL.md\`, \`agents/README.md\`,
   \`${entry.primaryAgentFile}\`, and this profile.
2. ORIENT through \`agent-goal-loop/goal-network.json\`, \`goal-review.md\`, and
   \`goal-review-state.json\`; filter first for the goals listed above.
3. Reassess whether current workspace threads fit those goals. If the folder
   signal and content signal disagree, treat the profile focus as the tie-breaker
   and write the ambiguity to the review surface instead of silently moving it.
4. Recommend or take the smallest next action that advances the goal, improves
   observability, or clarifies thread fit.
5. HANDOFF with compact state changes only; do not duplicate the shared loop.
`;
}

function writeProfileIndex(profileDir, workspaces) {
  const lines = [
    "# Agent Goal Loop Workspace Profiles",
    "",
    "Generated by `scripts/link-goal-loop-workspaces.mjs`.",
    "",
    "Each workspace links one of these files as `agent-goal-loop-profile.md`.",
    "The shared loop state remains in the registry root; these profiles only specialize agent identity, focus, and guardrails.",
    "",
    "| Workspace | Profile | Primary agent | Goals |",
    "|---|---|---|---|",
  ];
  for (const entry of workspaces) {
    const goals = entry.goalIds.length ? entry.goalIds.map((id) => `\`${id}\``).join(", ") : "auto";
    lines.push(`| ${entry.label} | \`${entry.slug}.md\` | ${entry.primaryAgent} | ${goals} |`);
  }
  fs.writeFileSync(path.join(profileDir, "README.md"), `${lines.join("\n")}\n`, "utf8");
}

function excludeFromGit(workspace, linkName) {
  try {
    const excludePath = execFileSync("git", ["-C", workspace, "rev-parse", "--git-path", "info/exclude"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!excludePath) return;
    const absoluteExcludePath = path.resolve(workspace, excludePath);
    fs.mkdirSync(path.dirname(absoluteExcludePath), { recursive: true });
    const existing = fs.existsSync(absoluteExcludePath) ? fs.readFileSync(absoluteExcludePath, "utf8") : "";
    const entries = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    if (entries.has(linkName) || entries.has(`/${linkName}`)) return;
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(absoluteExcludePath, `${prefix}${linkName}\n`, "utf8");
  } catch {
    // Non-git workspaces do not need a local exclude.
  }
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--target" || arg === "--link-name" || arg === "--profile-link-name") {
      parsed[arg.slice(2)] = argv[++i];
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function slugify(value) {
  return String(value || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
}

function isBrokenSymlink(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
