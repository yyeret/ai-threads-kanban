# AI Threads Kanban

A cross-harness kanban board for every in-flight AI work thread on your
machine — so threads get **finished**, not just started.

Scans the native session history of Claude Code, Codex, and Gemini CLI;
clusters sessions by intent into durable *threads*; classifies each thread
into a lifecycle stage; and renders it all as a local web board with
drag-and-drop, one-click *resume*, and harness-side archive on done.

```
Funnel/Triage → On Hold → Specify → Plan → Implement → Review/Ship → Done
```

No daemons. No telemetry. Everything runs locally; a Stop hook in each
harness keeps the board current.

---

## Install

Requires Node.js 18+ (Node 22 recommended).

**macOS / Linux**

```bash
git clone https://github.com/<your-fork>/ai-threads-kanban.git ~/Github/ai-threads-kanban
cd ~/Github/ai-threads-kanban
chmod +x scripts/install.sh
scripts/install.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/<your-fork>/ai-threads-kanban.git $HOME\Github\ai-threads-kanban
cd $HOME\Github\ai-threads-kanban
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

What the installer does:

1. Picks a registry root (honors `AI_AGENT_MEMORY_ROOT` if set; otherwise
   uses `~/.local/share/ai-threads-kanban` on POSIX or
   `%LOCALAPPDATA%\ai-threads-kanban` on Windows) and writes its path to
   `~/.config/ai-threads-kanban/registry-root`.
2. Renders the slash-command templates with this repo's path and copies
   them into whichever harness command directories exist on your machine
   (`~/.claude/commands`, `~/.codex/prompts`, `~/.gemini/commands`).
3. Wires `scripts/refresh-thread-board.{ps1,sh}` into the Codex Stop hook
   (created from scratch if absent). For Claude and Gemini it prints a
   TODO line you'll need to merge into your existing `settings.json` —
   those files are user-owned and the installer won't overwrite them.
4. Runs a first scan + reconcile so threads from the last 30 days show up.
5. Starts the board server in the background:
   - macOS: a launchd LaunchAgent (`com.yeretagility.ai-thread-board`).
   - Windows: a Scheduled Task ("AI Thread Board") at logon.
   - Linux: not auto-installed yet — start manually or wire your own systemd unit.

Re-run the installer any time the repo moves; it overwrites the slash
commands with the new path.

---

## Use

Open <http://127.0.0.1:7878>.

**List view** groups threads by stage, top-down from Done to Funnel
(finish before you start). Each section collapses; Done starts collapsed.

**Kanban view** is left-to-right flow. Drag a card to change its stage.
Three compact icons per card:

| | |
|---|---|
| ▶ | Open the session in a terminal and resume it. |
| ⏭ | Resume + copy the suggested next-step prompt to clipboard. |
| 📄 | Render the transcript (head + tail, harness preamble stripped). |

**Shareable view** (`/kanban-ipsum`) is the same shape with every card
title replaced by deterministic placeholder text — safe to screenshot.

### Slash commands

The installer wires three slash commands into each harness. Run them
**inside** the session whose thread you want to move:

| Command | Effect |
|---|---|
| `/thread-state <stage> [note]` | Move this thread to the named stage. Stages: `funnel`, `on-hold`, `specify`, `plan`, `implement`, `review`, `done`. |
| `/finish-thread [note]` | Mark done + archive (Codex: also archives the session in the harness picker). |
| `/track-thread [note]` | Force-track a thread the classifier left in Funnel. |

### Drag to Done

Dropping a card on the Done lane is equivalent to running `/finish-thread`
from inside the session — it sets `manual_status=done`, archives the
Codex rollout, and removes the session line from `~/.codex/session_index.jsonl`
(mirrors clicking Codex's own archive icon). For Claude and Gemini there's
no editable session title to mirror.

---

## How it stays current

Every harness already runs a `Stop` hook. The installer adds
`scripts/refresh-thread-board.{ps1,sh}` to each one, so the board
re-scans whenever any session ends. The refresh script never throws and
always exits 0 — a board refresh cannot break a session.

The web page also auto-refreshes every 60 seconds; "refresh now" in the
header re-runs scan + reconcile on demand.

---

## Multi-machine

The registry is one file (`active-threads.jsonl`) plus per-machine scan
outputs (`threads.<host>.jsonl`). If you point multiple machines at the
same registry root via Drive/Dropbox/etc.:

- Each machine writes its own `threads.<host>.jsonl`; reconcile merges them.
- `continue` / `log` links only work on the machine that owns the session.
- Drive sync latency makes the merged board eventually consistent (~minutes).
- Concurrent reconciles are last-writer-wins, but manual fields are
  preserved across writes.

Set `AI_AGENT_MEMORY_ROOT` to your shared folder before installing on
each machine and the installer will use it.

---

## Uninstall

```bash
# macOS
scripts/install-thread-board-launchagent.sh --uninstall

# Windows
Unregister-ScheduledTask -TaskName "AI Thread Board" -Confirm:$false
```

Then delete the slash commands from the harness command dirs and remove
the Stop-hook entries. The registry itself (under your registry root)
stays put — delete it manually if you want.

---

## Docs

- [`docs/architecture.md`](docs/architecture.md) — registry shape,
  classifier heuristics, scanner internals, known limitations.
- [`tests/README.md`](tests/README.md) — what's covered, how to add tests.

## License

MIT — see [LICENSE](LICENSE).
