#!/usr/bin/env node
// Run one goal-progress review cycle, or keep running it on an interval.
// The review is intentionally file-backed: it refreshes the goal network,
// evaluates observable progress, writes state/reports, and can notify locally.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveRegistryDir } from "./lib/paths.mjs";

const args = parseArgs(process.argv.slice(2));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const dir = path.resolve(args.dir ? expandHome(args.dir) : resolveRegistryDir());
const intervalDays = Number(args["interval-days"] || 7);

async function main() {
  if (args.watch) {
    while (true) {
      runCycle();
      await sleep(Math.max(1, intervalDays) * 24 * 60 * 60 * 1000);
    }
  }

  runCycle();
}

function runCycle() {
  ensureDir(dir);
  if (args.refresh) refreshInputs();

  const networkPath = path.join(dir, "goal-network.json");
  if (!fs.existsSync(networkPath)) {
    runNodeScript("extract-goal-network.mjs", []);
  }
  if (!fs.existsSync(networkPath)) {
    console.error(`Goal network not found: ${networkPath}`);
    process.exit(1);
  }

  const network = readJson(networkPath);
  const previousStatePath = path.join(dir, "goal-review-state.json");
  const previousState = fs.existsSync(previousStatePath) ? readJson(previousStatePath) : null;
  const previousByGoal = new Map((previousState?.goals || []).map((goal) => [goal.id, goal]));
  const reviewedAt = new Date().toISOString();
  const reviews = (network.goals || []).map((goal) => reviewGoal(goal, previousByGoal.get(goal.id), reviewedAt));
  const state = {
    schema_version: 1,
    generated_at: reviewedAt,
    source_goal_network: networkPath,
    source_goal_network_generated_at: network.generated_at || "",
    summary: summarizeReviews(reviews),
    goals: reviews,
  };

  const reviewedNetwork = {
    ...network,
    reviewed_at: reviewedAt,
    goals: (network.goals || []).map((goal) => ({
      ...goal,
      weekly_review: reviews.find((review) => review.id === goal.id) || null,
    })),
  };

  fs.writeFileSync(networkPath, `${JSON.stringify(reviewedNetwork, null, 2)}\n`, "utf8");
  fs.writeFileSync(previousStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.appendFileSync(path.join(dir, "goal-review-history.jsonl"), `${JSON.stringify(state)}\n`, "utf8");
  const reportPath = path.join(dir, "goal-review.md");
  fs.writeFileSync(reportPath, renderReport(state), "utf8");
  mirrorBoardFiles();

  const summary = `${state.summary.progressing} progressing, ${state.summary.no_progress} no-progress, ${state.summary.unobservable} unobservable, ${state.summary.blocked} blocked`;
  console.log(`Reviewed ${reviews.length} goals: ${summary} -> ${reportPath}`);
  if (args.notify) notify(`Goal review complete: ${summary}`, reportPath);
}

function mirrorBoardFiles() {
  if (args["no-mirror"]) return;
  const localDir = process.env.AI_THREADS_LOCAL_BOARD_DIR
    || path.join(process.env.XDG_DATA_HOME || path.join(process.env.HOME || process.env.USERPROFILE || "", ".local", "share"), "ai-threads-kanban");
  if (!localDir || path.resolve(localDir) === path.resolve(dir)) return;
  ensureDir(localDir);
  for (const file of [
    "active-threads.jsonl",
    "goal-network.json",
    "goal-network.md",
    "goal-overrides.json",
    "goal-review-state.json",
    "goal-review-history.jsonl",
    "goal-review.md",
    "machines.json",
  ]) {
    const src = path.join(dir, file);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, path.join(localDir, file));
      } catch {
        /* local mirror is best-effort */
      }
    }
  }
}

function refreshInputs() {
  runNodeScript("scan-session-history.mjs", ["--days", String(args.days || 30)], { optional: true });
  runNodeScript("reconcile-threads.mjs", [], { optional: true });
  runNodeScript("extract-goal-network.mjs", []);
}

function runNodeScript(scriptName, scriptArgs, { optional = false } = {}) {
  const result = spawnSync(process.execPath, [path.join(scriptDir, scriptName), ...scriptArgs], {
    cwd: path.join(scriptDir, ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !optional) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}

function reviewGoal(goal, previous, reviewedAt) {
  const metrics = metricsFor(goal);
  const canvas = loadGoalCanvas(goal);
  const previousMetrics = previous?.metrics || null;
  const deltas = previousMetrics ? {
    supporting_threads: metrics.supporting_threads - previousMetrics.supporting_threads,
    traction_evidence: metrics.traction_evidence - previousMetrics.traction_evidence,
    activity_evidence: metrics.activity_evidence - previousMetrics.activity_evidence,
    blockers: metrics.blockers - previousMetrics.blockers,
  } : {
    supporting_threads: 0,
    traction_evidence: 0,
    activity_evidence: 0,
    blockers: 0,
  };

  const indicators = [
    ...(Array.isArray(goal.key_results) ? goal.key_results : []),
    ...(Array.isArray(goal.leading_indicators) ? goal.leading_indicators : []),
    ...(Array.isArray(canvas?.key_results) ? canvas.key_results : []),
    ...(Array.isArray(canvas?.leading_indicators) ? canvas.leading_indicators : []),
  ].filter(Boolean);

  const status = statusFor(metrics, deltas, indicators);
  const nextBestAction = nextBestActionFor(goal, metrics, status, indicators);
  const associationReview = reviewThreadAssociations(goal, canvas, previous);

  return {
    id: goal.id,
    title: goal.title,
    reviewed_at: reviewedAt,
    status,
    lifecycle_stage: goal.lifecycle_stage || "",
    traction_status: goal.traction_status || "",
    intent_canvas_ref: canvas?.ref || goal.intent_canvas_ref || "",
    metrics,
    deltas,
    indicators,
    association_review: associationReview,
    progress_summary: progressSummaryFor(goal, status, metrics, deltas, indicators),
    next_best_action: nextBestActionForAssociation(nextBestAction, associationReview),
  };
}

function loadGoalCanvas(goal) {
  const candidates = [
    goal.intent_canvas_ref,
    path.join("docs", "goal-intents", `${goal.id}.md`),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const absolute = path.resolve(repoRoot, expandHome(candidate));
    if (absolute !== repoRoot && !absolute.startsWith(repoRoot + path.sep)) continue;
    if (!fs.existsSync(absolute)) continue;
    const parsed = parseCanvasFile(absolute);
    if (parsed.goal_id && parsed.goal_id !== goal.id) continue;
    return { ...parsed, ref: path.relative(repoRoot, absolute) };
  }
  return null;
}

function parseCanvasFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  return parseFrontmatter(match[1]);
}

function parseFrontmatter(text) {
  const out = {};
  let currentKey = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      currentKey = pair[1];
      const value = pair[2];
      out[currentKey] = value ? unquote(value) : [];
      continue;
    }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && currentKey) {
      if (!Array.isArray(out[currentKey])) out[currentKey] = [];
      out[currentKey].push(unquote(item[1]));
    }
  }
  return out;
}

function reviewThreadAssociations(goal, canvas, previous) {
  const supportingThreads = goal.supporting_threads || [];
  const previousThreadIds = new Set(previous?.association_review?.threads?.map((thread) => thread.thread_id) || []);
  const threads = supportingThreads.map((thread) => reviewThreadFit(thread, goal, canvas, previousThreadIds));
  const counts = {
    total: threads.length,
    strong_fit: threads.filter((thread) => thread.fit === "strong_fit").length,
    weak_fit: threads.filter((thread) => thread.fit === "weak_fit").length,
    possible_misfit: threads.filter((thread) => thread.fit === "possible_misfit").length,
    needs_canvas: canvas ? 0 : supportingThreads.length,
    new_threads: threads.filter((thread) => thread.is_new).length,
  };
  return {
    canvas_ref: canvas?.ref || goal.intent_canvas_ref || "",
    has_canvas: Boolean(canvas),
    counts,
    recommendation: associationRecommendationFor(goal, counts, canvas),
    threads,
  };
}

function reviewThreadFit(thread, goal, canvas, previousThreadIds) {
  if (!canvas) {
    return {
      thread_id: thread.thread_id,
      title: thread.title || "",
      fit: "needs_canvas",
      matched_fit_signals: [],
      matched_anti_fit_signals: [],
      recommendation: "Create a Lean Product Canvas intent doc before judging thread fit.",
      is_new: !previousThreadIds.has(thread.thread_id),
    };
  }

  const text = [
    thread.title,
    thread.outcome_intent,
    thread.next_step,
    thread.stage,
    thread.status,
    thread.repo_key,
    thread.session_cwd,
    thread.transcript_path,
  ].join(" ").toLowerCase();
  const fitSignals = signalMatches(text, [...(canvas.fit_signals || []), ...(goal.fit_signals || [])]);
  const antiFitSignals = signalMatches(text, [...(canvas.anti_fit_signals || []), ...(goal.anti_fit_signals || [])]);
  let fit = "weak_fit";
  if (antiFitSignals.length || fitSignals.length === 0) fit = "possible_misfit";
  else if (fitSignals.length >= 2) fit = "strong_fit";

  return {
    thread_id: thread.thread_id,
    title: thread.title || "",
    fit,
    matched_fit_signals: fitSignals,
    matched_anti_fit_signals: antiFitSignals,
    recommendation: threadFitRecommendation(fit, goal, canvas),
    is_new: !previousThreadIds.has(thread.thread_id),
  };
}

function signalMatches(text, signals) {
  return [...new Set((signals || [])
    .map((signal) => String(signal || "").trim())
    .filter(Boolean)
    .filter((signal) => text.includes(signal.toLowerCase())))];
}

function threadFitRecommendation(fit, goal, canvas) {
  if (fit === "strong_fit") return "Keep associated with this goal.";
  if (fit === "weak_fit") return "Keep for now, but clarify the outcome or next action.";
  if (goal.id === "other-unsorted") return "Move, suppress, or ask Yuval whether this exposes a new goal.";
  const question = (canvas.straying_questions || goal.straying_questions || [])[0];
  return question || "Review this thread; it may belong to another goal or need suppression.";
}

function associationRecommendationFor(goal, counts, canvas) {
  if (!canvas) return `Create an intent canvas for goal \`${goal.id}\` before reviewing thread fit.`;
  if (goal.id === "other-unsorted") return "Treat this bucket as a cleanup queue: move, suppress, or escalate each associated thread.";
  if (counts.possible_misfit > 0) return `Review ${counts.possible_misfit} possible misfit thread${counts.possible_misfit === 1 ? "" : "s"} and move or suppress as needed.`;
  if (counts.weak_fit > counts.strong_fit) return "Clarify weak-fit threads so the loop can distinguish real goal work from adjacent activity.";
  return "Associated threads mostly fit this goal; continue reviewing new arrivals weekly.";
}

function nextBestActionForAssociation(baseAction, associationReview) {
  if (!associationReview?.has_canvas) return baseAction;
  if (baseAction?.kind === "unblock") return baseAction;
  if (associationReview.counts.possible_misfit > 0) {
    return {
      kind: "review_thread_fit",
      text: associationReview.recommendation,
    };
  }
  return baseAction;
}

function metricsFor(goal) {
  return {
    supporting_threads: (goal.supporting_threads || []).length,
    traction_evidence: (goal.traction_evidence || []).length,
    activity_evidence: (goal.activity_evidence || []).length,
    blockers: (goal.blockers || []).length,
    explicit_next_actions: (goal.next_actions || []).filter((action) => !isClarifyAction(action.text)).length,
  };
}

function statusFor(metrics, deltas, indicators) {
  if (metrics.blockers > 0) return "blocked";
  if (!indicators.length && metrics.traction_evidence === 0) return "unobservable";
  if (deltas.traction_evidence > 0 || (deltas.supporting_threads > 0 && metrics.traction_evidence > 0)) return "progressing";
  if (metrics.traction_evidence > 0 && metrics.explicit_next_actions > 0) return "progressing";
  return "no_progress";
}

function nextBestActionFor(goal, metrics, status, indicators) {
  if (status === "blocked") {
    const blocker = (goal.blockers || [])[0];
    return {
      kind: "unblock",
      text: blocker
        ? `Resolve or reclassify blocker on thread ${blocker.thread_id}: ${blocker.text}`
        : "Identify the blocker preventing visible progress and either remove it or move the goal to hold.",
    };
  }

  if (status === "unobservable" || !indicators.length) {
    return {
      kind: "make_observable",
      text: `Add 1-3 key results or leading indicators for goal \`${goal.id}\` in goal-overrides.json, then rerun the review.`,
    };
  }

  const explicit = (goal.next_actions || []).find((action) => action.text && !isClarifyAction(action.text));
  if (explicit) {
    return { kind: "drive_goal", text: explicit.text, thread_id: explicit.thread_id || "" };
  }

  return {
    kind: "drive_goal",
    text: `Pick one supporting thread for \`${goal.id}\` and define the smallest action that could create traction evidence before the next review.`,
  };
}

function progressSummaryFor(goal, status, metrics, deltas, indicators) {
  if (status === "blocked") return `Blocked: ${metrics.blockers} blocker signal(s) are present.`;
  if (status === "unobservable") return "Unable to track real progress yet: no explicit indicators and no traction evidence.";
  if (status === "progressing") {
    if (deltas.traction_evidence > 0) return `Progress: traction evidence increased by ${deltas.traction_evidence}.`;
    return `Progress is visible, with ${metrics.traction_evidence} traction signal(s) and ${indicators.length} explicit indicator(s).`;
  }
  if (metrics.activity_evidence > 0 && metrics.traction_evidence === 0) {
    return `No traction progress visible yet: ${metrics.activity_evidence} activity signal(s), 0 traction signal(s).`;
  }
  return "No progress signal found in this review cycle.";
}

function summarizeReviews(reviews) {
  const count = (status) => reviews.filter((review) => review.status === status).length;
  return {
    total: reviews.length,
    progressing: count("progressing"),
    no_progress: count("no_progress"),
    unobservable: count("unobservable"),
    blocked: count("blocked"),
  };
}

function renderReport(state) {
  const lines = [
    "# Goal Progress Review",
    "",
    `Generated: ${state.generated_at}`,
    `Source goal network: \`${state.source_goal_network}\``,
    "",
    "## Summary",
    "",
    `- Goals reviewed: ${state.summary.total}`,
    `- Progressing: ${state.summary.progressing}`,
    `- No progress visible: ${state.summary.no_progress}`,
    `- Unobservable: ${state.summary.unobservable}`,
    `- Blocked: ${state.summary.blocked}`,
    "",
    "## Goals",
    "",
  ];

  for (const goal of state.goals) {
    lines.push(`### ${escapeMd(goal.title)}`, "");
    lines.push(`- Goal ID: \`${goal.id}\``);
    lines.push(`- Review status: ${goal.status}`);
    lines.push(`- Lifecycle: ${escapeMd(goal.lifecycle_stage || "unknown")}`);
    lines.push(`- Traction status: ${escapeMd(goal.traction_status || "unknown")}`);
    if (goal.intent_canvas_ref) lines.push(`- Intent canvas: \`${goal.intent_canvas_ref}\``);
    lines.push(`- Metrics: ${goal.metrics.supporting_threads} threads, ${goal.metrics.traction_evidence} traction, ${goal.metrics.activity_evidence} activity, ${goal.metrics.blockers} blockers`);
    lines.push(`- Delta since previous review: traction ${formatDelta(goal.deltas.traction_evidence)}, activity ${formatDelta(goal.deltas.activity_evidence)}, threads ${formatDelta(goal.deltas.supporting_threads)}, blockers ${formatDelta(goal.deltas.blockers)}`);
    lines.push(`- Progress readout: ${escapeMd(goal.progress_summary)}`);
    if (goal.association_review) {
      const counts = goal.association_review.counts;
      lines.push(`- Thread fit: ${counts.strong_fit} strong, ${counts.weak_fit} weak, ${counts.possible_misfit} possible misfit, ${counts.new_threads} new`);
      lines.push(`- Thread-fit recommendation: ${escapeMd(goal.association_review.recommendation)}`);
      for (const thread of goal.association_review.threads.filter((item) => item.fit === "possible_misfit").slice(0, 5)) {
        lines.push(`  - Possible misfit \`${thread.thread_id}\`: ${escapeMd(thread.title)} — ${escapeMd(thread.recommendation)}`);
      }
    }
    lines.push(`- Next best action (${goal.next_best_action.kind}): ${escapeMd(goal.next_best_action.text)}`);
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function notify(message, reportPath) {
  if (process.platform === "darwin") {
    spawnSync("osascript", [
      "-e",
      `display notification ${JSON.stringify(reportPath)} with title "AI Goal Loop" subtitle ${JSON.stringify(message)}`,
    ], { stdio: "ignore" });
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function ensureDir(file) {
  fs.mkdirSync(file, { recursive: true });
}

function isClarifyAction(text) {
  return /^Clarify the next outcome-moving action/i.test(String(text || ""));
}

function escapeMd(text) {
  return String(text || "").replace(/\|/g, "\\|");
}

function formatDelta(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function unquote(value) {
  return String(value || "").replace(/^['"]|['"]$/g, "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

main();
