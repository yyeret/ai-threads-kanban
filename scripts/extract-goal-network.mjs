#!/usr/bin/env node
// Derive a file-backed goal network from the active thread registry.
// This is intentionally deterministic: it uses existing registry fields first
// so the result is inspectable and correctable before any LLM enrichment.

import fs from "node:fs";
import path from "node:path";
import { resolveRegistryDir } from "./lib/paths.mjs";

const args = parseArgs(process.argv.slice(2));
const dir = path.resolve(args.dir ? expandHome(args.dir) : resolveRegistryDir());
const registryPath = path.join(dir, "active-threads.jsonl");
const jsonPath = path.join(dir, "goal-network.json");
const mdPath = path.join(dir, "goal-network.md");
const overridesPath = path.resolve(args.overrides ? expandHome(args.overrides) : path.join(dir, "goal-overrides.json"));

if (!fs.existsSync(registryPath)) {
  console.error(`Thread registry not found: ${registryPath}`);
  process.exit(1);
}

const allThreads = readJsonl(registryPath);
const overrides = loadOverrides(overridesPath);
const threads = allThreads
  .filter((thread) => args["include-done"] || isLiveThread(thread))
  .filter((thread) => !threadOverrideFor(thread, overrides).suppress);
const network = buildGoalNetwork(threads, { registryPath, overridesPath: fs.existsSync(overridesPath) ? overridesPath : "", overrides });

fs.writeFileSync(jsonPath, `${JSON.stringify(network, null, 2)}\n`, "utf8");
fs.writeFileSync(mdPath, renderGoalNetwork(network), "utf8");

console.log(`Extracted ${network.goals.length} goals from ${network.thread_count} threads -> ${jsonPath}`);

export function buildGoalNetwork(threads, { registryPath: sourceRegistry = "", overridesPath: sourceOverrides = "", overrides = emptyOverrides() } = {}) {
  const generatedAt = new Date().toISOString();
  const groups = groupBy(threads, (thread) => goalKeyFor(thread, overrides));
  const aliasedGoalIds = new Set(Object.keys(overrides.goal_overrides || {}).map(slugify));
  for (const goalId of Object.keys(overrides.goals || {})) {
    const normalized = slugify(goalId);
    if (aliasedGoalIds.has(normalized)) continue;
    if (!groups.has(normalized)) groups.set(normalized, []);
  }
  const goals = [...groups.entries()]
    .map(([goalId, items]) => buildGoal(goalId, items, overrides))
    .sort((a, b) => b.supporting_threads.length - a.supporting_threads.length || a.title.localeCompare(b.title));

  return {
    schema_version: 1,
    generated_at: generatedAt,
    source_registry: sourceRegistry,
    source_overrides: sourceOverrides,
    thread_count: threads.length,
    goal_count: goals.length,
    goals,
  };
}

function buildGoal(goalId, threads, overrides) {
  const sorted = [...threads].sort(byActivityDesc);
  const derivedArea = normalizeArea(sorted[0]?.intent_area);
  const meta = goalMetaFor(goalId, derivedArea, overrides);
  const supportingThreads = sorted.map((thread) => ({
    thread_id: thread.thread_id,
    title: thread.display_title || thread.title || "Untitled thread",
    outcome_intent: thread.outcome_intent || "",
    stage: thread.stage || "",
    status: thread.status || "",
    repo_key: thread.repo_key || "",
    session_cwd: thread.sessions?.[0]?.cwd || "",
    last_activity: thread.last_activity || "",
    next_step: thread.next_step || "",
    resume: thread.sessions?.[0]?.resume || "",
    transcript_path: thread.sessions?.[0]?.transcript_path || "",
  }));

  const evidence = sorted.flatMap((thread) => evidenceForThread(thread));
  const tractionEvidence = evidence.filter((item) => item.kind === "traction");
  const activityEvidence = evidence.filter((item) => item.kind === "activity");
  const blockedThreads = sorted.filter((thread) => thread.blocked || /block|stuck|waiting|hold/i.test(`${thread.where_it_stands} ${thread.notes}`));

  const goal = {
    id: meta.id,
    title: meta.title,
    outcome_statement: meta.outcome_statement,
    area: meta.area,
    lifecycle_stage: meta.lifecycle_stage,
    intent_canvas_ref: meta.intent_canvas_ref,
    key_results: meta.key_results,
    leading_indicators: meta.leading_indicators,
    fit_signals: meta.fit_signals,
    anti_fit_signals: meta.anti_fit_signals,
    straying_questions: meta.straying_questions,
    agent_role_refs: meta.agent_role_refs,
    confidence: confidenceFor(sorted, tractionEvidence),
    traction_status: meta.traction_status || tractionStatusFor(sorted, tractionEvidence),
    supporting_threads: supportingThreads,
    child_outcomes: sorted.map((thread) => ({
      thread_id: thread.thread_id,
      statement: thread.outcome_intent || thread.display_title || thread.title || "Clarify this thread outcome",
      framing: classifyFraming(thread.outcome_intent || thread.title || ""),
    })),
    assumptions: assumptionsFor(meta.area, sorted),
    activity_evidence: activityEvidence.map(stripKind),
    traction_evidence: tractionEvidence.map(stripKind),
    blockers: blockedThreads.map((thread) => ({
      thread_id: thread.thread_id,
      text: truncate(thread.where_it_stands || thread.notes || "Blocked or waiting signal detected.", 180),
    })),
    next_actions: nextActionsFor(sorted),
    resume_prompt: "",
  };
  goal.resume_prompt = resumePromptFor(goal);
  return goal;
}

function evidenceForThread(thread) {
  const snippets = [
    thread.where_it_stands,
    thread.notes,
    thread.status ? `Status: ${thread.status}` : "",
  ].filter(Boolean);
  if (!snippets.length) return [];
  const text = snippets.join(" ");
  const kind = isTractionSignal(text) ? "traction" : "activity";
  return [{
    kind,
    thread_id: thread.thread_id,
    text: truncate(text, 220),
  }];
}

function nextActionsFor(threads) {
  const explicit = threads
    .filter((thread) => thread.next_step)
    .map((thread) => ({ thread_id: thread.thread_id, text: thread.next_step }));
  if (explicit.length) return explicit.slice(0, 5);

  return threads.slice(0, 5).map((thread) => ({
    thread_id: thread.thread_id,
    text: `Clarify the next outcome-moving action for thread ${thread.thread_id}.`,
  }));
}

function assumptionsFor(area, threads) {
  return [
    `Thread records contain enough signal to infer useful ${area} goal context.`,
    "Manual corrections will be needed for naming, merging, and splitting goal nodes.",
    `${threads.length} supporting thread${threads.length === 1 ? "" : "s"} belong together strongly enough to review as one goal area.`,
  ];
}

function resumePromptFor(goal) {
  const ids = goal.supporting_threads.map((thread) => thread.thread_id).join(", ");
  return `/goal Drive toward: ${goal.outcome_statement} Supporting threads: ${ids}. Each cycle: review activity evidence vs traction evidence, choose the one next action that most improves the goal, execute it, then update goal-network evidence.`;
}

function classifyFraming(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(revenue|retention|conversion|roi|cost|qualified|lead|pipeline|booked|pv|traffic)\b/.test(t)) return "impact";
  if (/\b(can|able to|visibility|understand|decide|choose|self-serve|trust|inspect|resume)\b/.test(t)) return "outcome";
  if (/\b(app|script|dashboard|page|api|integration|view|artifact|json|markdown|repo)\b/.test(t)) return "output";
  if (/\b(add|build|create|implement|fix|update|test|install|configure|publish|write)\b/.test(t)) return "activity";
  return "unknown";
}

function confidenceFor(threads, tractionEvidence) {
  if (threads.length >= 3 && tractionEvidence.length >= 2) return "high";
  if (threads.length >= 2 || tractionEvidence.length >= 1) return "medium";
  return "low";
}

function tractionStatusFor(threads, tractionEvidence) {
  if (tractionEvidence.length >= 2 && threads.length >= 3) return "green";
  if (tractionEvidence.length >= 1) return "yellow";
  return "red";
}

function isLiveThread(thread) {
  if (thread.stage === "Done / Archive Candidates") return false;
  if (thread.tracking_decision === "archive") return false;
  if (thread.manual_status === "done") return false;
  return true;
}

function isTractionSignal(text) {
  if (/\b(no|low|without|missing)\s+evidence\b/i.test(text)) return false;
  return /\b(done|passed|pass|pushed|published|shipped|validated|merged|created|deployed|released|scheduled|qualified|booked|converted|commit|evidence|approved)\b/i.test(text);
}

function normalizeArea(area) {
  return String(area || "Other / Unsorted").trim() || "Other / Unsorted";
}

function goalKeyFor(thread, overrides) {
  const threadOverride = threadOverrideFor(thread, overrides);
  if (threadOverride.goal_id) {
    const overrideGoalId = slugify(threadOverride.goal_id);
    const targetOverride = overrides.goal_overrides[overrideGoalId] || {};
    return slugify(targetOverride.goal_id || overrideGoalId);
  }
  const folderGoalId = folderGoalForThread(thread);
  if (folderGoalId && overrides.goals[folderGoalId]) return folderGoalId;
  const baseGoalId = slugify(normalizeArea(thread.intent_area));
  const goalOverride = overrides.goal_overrides[baseGoalId] || {};
  return slugify(goalOverride.goal_id || baseGoalId);
}

function folderGoalForThread(thread) {
  const haystack = [
    thread.repo_key,
    thread.sessions?.[0]?.cwd,
    thread.sessions?.[0]?.transcript_path,
    thread.title,
    thread.display_title,
    thread.outcome_intent,
    thread.where_it_stands,
    thread.next_step,
  ].join(" ").toLowerCase();

  const aiNativeDeliveryContent = /(customizing safe|safe.*spec-driven|spec-driven thing|spec-driven.*(ai development|ai-native|ai native|delivery)|ai-native guidance|ai native guidance|guidance layers?|engineering to adoption|adoption bottleneck|operating model mismatch|ai value realization|ai theater)/.test(haystack);
  const siteContentWorkflow = /(c-sdd|content-sdd|content-drafts|backlog[\\/]+content-drafts|article|blog|post|insight|content|copy|draft|category)/.test(haystack);

  if (aiNativeDeliveryContent) {
    return "ai-native-delivery-systems";
  }
  if (/(ai-threads-kanban|ai-skill-library|agent-memory|skill-library)/.test(haystack)) {
    return "internal-ai-operating-system";
  }
  if (/(post effectiveness|topic performance|linkedin analytics|gsc|backlink|search console|seo|aeo|content graph|buffer|rss|syndicat|podcast)/.test(haystack)) {
    return "marketing-discoverability";
  }
  if (/(crm ops|sales|proposal|pipeline|mini crm|customers\/|customer relationship)/.test(haystack)) {
    return "revenue-pipeline-outreach";
  }
  if (/(seeking full-time roles|job search|auto-apply|application package|career)/.test(haystack)) {
    return "personal-life-admin";
  }
  if (/(marketing engine|linkedin|analytics)/.test(haystack)) {
    return "marketing-discoverability";
  }
  if (/yeret-agility-site/.test(haystack)) {
    if (siteContentWorkflow || /(rss|syndicat|seo|aeo)/.test(haystack)) return "marketing-discoverability";
    return "website-developer";
  }
  if (/(ai transformation consulting|ai transformation|ai value realization|ai theater|delivery system|operating model mismatch)/.test(haystack)) {
    if (/(positioning|pov|point of view|thought leadership|talk|abstract|thesis|narrative)/.test(haystack)) return "gtm-strategy-positioning";
    return "ai-native-delivery-systems";
  }
  return "";
}

function goalMetaFor(goalId, derivedArea, overrides) {
  const meta = overrides.goals[goalId] || {};
  return {
    id: goalId,
    title: meta.title || `Agents can improve ${meta.area || derivedArea} outcomes`,
    outcome_statement: meta.outcome_statement || `Agents and Yuval can make better decisions about ${meta.area || derivedArea} work by seeing the related threads, evidence, blockers, and next action in one place.`,
    area: meta.area || derivedArea,
    lifecycle_stage: meta.lifecycle_stage || lifecycleStageForGoal(goalId, overrides),
    intent_canvas_ref: meta.intent_canvas_ref || "",
    key_results: Array.isArray(meta.key_results) ? meta.key_results : [],
    leading_indicators: Array.isArray(meta.leading_indicators) ? meta.leading_indicators : [],
    fit_signals: Array.isArray(meta.fit_signals) ? meta.fit_signals : [],
    anti_fit_signals: Array.isArray(meta.anti_fit_signals) ? meta.anti_fit_signals : [],
    straying_questions: Array.isArray(meta.straying_questions) ? meta.straying_questions : [],
    agent_role_refs: Array.isArray(meta.agent_role_refs) ? meta.agent_role_refs : [],
    traction_status: meta.traction_status || "",
  };
}

function lifecycleStageForGoal(goalId, overrides) {
  const meta = overrides.goals[goalId] || {};
  if (meta.lifecycle_stage) return meta.lifecycle_stage;
  return "Considering / Exploring";
}

function threadOverrideFor(thread, overrides) {
  return overrides.thread_overrides[thread.thread_id] || {};
}

function loadOverrides(file) {
  if (!file || !fs.existsSync(file)) return emptyOverrides();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      schema_version: parsed.schema_version || 1,
      goals: parsed.goals && typeof parsed.goals === "object" ? parsed.goals : {},
      thread_overrides: parsed.thread_overrides && typeof parsed.thread_overrides === "object" ? parsed.thread_overrides : {},
      goal_overrides: parsed.goal_overrides && typeof parsed.goal_overrides === "object" ? parsed.goal_overrides : {},
    };
  } catch (err) {
    console.error(`Could not parse goal overrides: ${file}`);
    console.error(err.message);
    process.exit(1);
  }
}

function emptyOverrides() {
  return { schema_version: 1, goals: {}, thread_overrides: {}, goal_overrides: {} };
}

function renderGoalNetwork(network) {
  const lines = [
    "# Goal Network",
    "",
    `Generated: ${network.generated_at}`,
    `Source registry: \`${network.source_registry}\``,
    `Source overrides: ${network.source_overrides ? `\`${network.source_overrides}\`` : "_none_"}`,
    `Threads analyzed: ${network.thread_count}`,
    `Goals: ${network.goal_count}`,
    "",
  ];

  for (const goal of network.goals) {
    lines.push(`## ${escapeMd(goal.title)}`, "");
    lines.push(goal.outcome_statement, "");
    lines.push(`- Goal ID: \`${goal.id}\``);
    lines.push(`- Area: ${escapeMd(goal.area)}`);
    lines.push(`- Lifecycle: ${escapeMd(goal.lifecycle_stage)}`);
    lines.push(`- Traction: ${escapeMd(goal.traction_status)}`);
    if (goal.intent_canvas_ref) lines.push(`- Intent canvas: \`${goal.intent_canvas_ref}\``);
    if (goal.agent_role_refs.length) lines.push(`- Agent roles: ${goal.agent_role_refs.map((role) => `\`${role}\``).join(", ")}`);
    lines.push(`- Confidence: ${goal.confidence}`);
    lines.push(`- Supporting threads: ${goal.supporting_threads.map((thread) => `\`${thread.thread_id}\``).join(", ")}`);
    lines.push("");

    lines.push("### Key results / leading indicators", "");
    if (goal.key_results.length || goal.leading_indicators.length) {
      for (const result of goal.key_results) lines.push(`- KR: ${escapeMd(result)}`);
      for (const indicator of goal.leading_indicators) lines.push(`- Leading: ${escapeMd(indicator)}`);
    } else {
      lines.push("- None defined yet.");
    }
    lines.push("");

    lines.push("### Child outcomes", "");
    for (const outcome of goal.child_outcomes) {
      lines.push(`- \`${outcome.thread_id}\` [${outcome.framing}] ${escapeMd(outcome.statement)}`);
    }
    lines.push("");

    lines.push("### Traction evidence", "");
    if (goal.traction_evidence.length) {
      for (const item of goal.traction_evidence) lines.push(`- \`${item.thread_id}\` ${escapeMd(item.text)}`);
    } else {
      lines.push("- None found yet.");
    }
    lines.push("");

    lines.push("### Activity evidence", "");
    if (goal.activity_evidence.length) {
      for (const item of goal.activity_evidence) lines.push(`- \`${item.thread_id}\` ${escapeMd(item.text)}`);
    } else {
      lines.push("- None found yet.");
    }
    lines.push("");

    lines.push("### Next actions", "");
    for (const action of goal.next_actions) lines.push(`- \`${action.thread_id}\` ${escapeMd(action.text)}`);
    lines.push("");

    lines.push("### Resume prompt", "");
    lines.push("```text");
    lines.push(goal.resume_prompt);
    lines.push("```", "");
  }

  return `${lines.join("\n").trim()}\n`;
}

function stripKind({ kind, ...rest }) {
  return rest;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function byActivityDesc(a, b) {
  return Date.parse(b.last_activity || 0) - Date.parse(a.last_activity || 0);
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function slugify(text) {
  return String(text || "goal")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "goal";
}

function truncate(text, length) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.length > length ? `${cleaned.slice(0, length - 3)}...` : cleaned;
}

function escapeMd(text) {
  return String(text || "").replace(/\|/g, "\\|");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  }
  return out;
}

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return process.env.HOME || process.env.USERPROFILE || value;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(process.env.HOME || process.env.USERPROFILE || "", value.slice(2));
  }
  return value;
}
