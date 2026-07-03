# Agent Directory and Collaboration Protocols

This document defines the AI agents collaborating on the `ai-threads-kanban` project, their respective roles, tool configurations, and the shared protocols they must follow.

## Collaborating Agents

### 1. Antigravity (Google Gemini 3.5 Pro/Flash)
- **Role:** Primary Cockpit & Manager. Focuses on repository orchestration, workspace management, layout planning, and high-level structure.
- **Key Strengths:** Artifact-based workflow review, browser automation, multi-agent definition, and large-context synthesis.
- **Harness UI:** Antigravity Manager Surface / Editor.

### 2. Claude Code (Anthropic Claude 3.5 Sonnet)
- **Role:** High-Control Local Reasoner. Best for rapid local code editing, running tests, refactoring, and local script execution.
- **Key Strengths:** Quick iteration loop, deep terminal integration, and direct local refactoring.
- **Harness UI:** Claude CLI (`claude`).

### 3. Codex (OpenAI GPT-4o / Codex-Native)
- **Role:** Local/Cloud Generalist. Used for Codex-native local/cloud workflows and remote operations.
- **Key Strengths:** Strong cross-device continuation and ChatGPT integration.
- **Harness UI:** Codex App / CLI (`codex`).

### 4. Gemini CLI (Google Gemini)
- **Role:** General development and fallback CLI harness.
- **Harness UI:** Gemini CLI (`gemini`).

---

## Build and test
- Install dependencies: `npm install`
- Run tests: `npm test`

## Shared Collaboration Protocols

All agents working on this repository must strictly adhere to the following rules:

1. **Constitutional Alignment:** Respect the global [SOUL.md](file:///C:/Users/yuval/agent-memory/SOUL.md) for core voice, stance, and decision-making guidelines.
2. **Layered Memory Maintenance:** Do not let transcripts be the sole memory. Maintain `/docs/agent-memory/CURRENT_STATE.md` (active focus/loops), `/docs/agent-memory/NEXT_STEPS.md` (next steps), and specific thread folders under `/docs/agent-memory/threads/<thread-slug>/thread-state.md` during or at the end of each session.
3. **OS Version Tracking:** When making code changes that affect scanner, reconciler, server, or installers, increment the version in `package.json`, and run `powershell -ExecutionPolicy Bypass -File scripts/install.ps1` (or `scripts/install.sh` on macOS) to deploy your changes and update configurations.
4. **Git Discipline:** Keep commits clean and focused. Reference thread slugs or commit hashes in thread state files.
5. **No Placeholders:** Generate real code and assets; avoid generic templates.
