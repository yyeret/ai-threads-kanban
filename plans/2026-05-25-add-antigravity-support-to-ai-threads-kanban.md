# Add Antigravity Support to AI Threads Kanban

This plan implements full support for scanning and rendering **Antigravity** sessions/threads in the AI Threads Kanban Board. It enables listing, tracking, and reviewing logs of Antigravity sessions side-by-side with Claude Code, Codex, and Gemini CLI.

## Proposed Changes

We will modify two core files in the `ai-threads-kanban` repository to scan and display Antigravity's sessions.

---

### [Component 1] Session History Scanner

#### [MODIFY] [scan-session-history.mjs](file:///c:/Users/yuval/Github/ai-threads-kanban/scripts/scan-session-history.mjs)

We will add a new `scanAntigravity()` function to read and parse Antigravity's native `transcript.jsonl` files stored under the `brain` directories.

1. **Locate transcripts:**
   Scan folders under `~/.gemini/antigravity/brain/*/` matching the structure `.system_generated/logs/transcript.jsonl`.
2. **Extract metadata:**
   - `sessionId`: Derived from the folder name (UUID).
   - `created_at` / `lastTimestamp`: Extracted from the timestamps in the JSONL objects.
   - `cwd` (workspace path): Recovered from `<user_information>` blocks inside user messages, or fallback to parsing tool calls (`AbsolutePath`, `TargetFile`, `SearchPath`, `Cwd`) to detect paths matching `c:\Users\yuval\Github\<repo-name>`.
   - `firstPrompt`: First substantive user input extracted via `substantivePrompt()`.
   - `latest`: Last assistant or model message.
   - `toolCount`: Total number of tool calls triggered.
3. **Card generation:**
   Generate cards with the `Antigravity` harness tag, and define a fallback `resumeCommand` (which instructs the user to open the folder in VSCode since Antigravity does not have a direct command-line resume executable).

---

### [Component 2] Web Board Log Renderer

#### [MODIFY] [serve-thread-board.mjs](file:///c:/Users/yuval/Github/ai-threads-kanban/scripts/serve-thread-board.mjs)

We will update the log rendering logic so that users can review Antigravity transcripts in detail from the board web UI.

1. **Extract Message support:**
   Update the `extractMessage(o)` helper to handle:
   - User inputs (`type === "USER_INPUT" && o.content` -> `user`)
   - Model responses (`type === "PLANNER_RESPONSE" && o.content && o.source === "MODEL"` -> `assistant`)

---

## Verification Plan

### Automated/Manual Scans
- We will execute the scan script `node scripts/scan-session-history.mjs --days 30` to verify that Antigravity sessions are parsed correctly and outputted without errors.
- We will execute the reconcile script `node scripts/reconcile-threads.mjs` to ensure the threads cluster and write to the board markdown files.
- We will run the board server `node scripts/serve-thread-board.mjs` and inspect the Kanban/List UI to verify that the Antigravity sessions are shown correctly and logs can be reviewed successfully.
