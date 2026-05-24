# Thread Cleanup Playbook

How to run a manual cleanup pass on a machine's thread registry — closing stale/done threads, archiving Codex sessions, and leaving the board in a signal-rich state.

Run this once per machine every few weeks, or whenever the Funnel/Triage count grows large.

---

## Step 1 — Full scan (extend the window)

The default scan is 30 days. A cleanup pass should cover all local history:

```bash
# Check the oldest session on this machine first
node -e "
const fs = require('fs'), os = require('os'), path = require('path');
const idx = fs.readFileSync(path.join(os.homedir(), '.codex/session_index.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));
const dates = idx.map(l => l.updated_at||l.created_at).filter(Boolean).sort();
const days = Math.ceil((Date.now() - new Date(dates[0]).getTime()) / 86400000);
console.log('Oldest Codex session:', dates[0], '→ use --days', days + 10);
"

# Then scan with that window
node scripts/scan-session-history.mjs --days <N>
node scripts/reconcile-threads.mjs
```

---

## Step 2 — Archive Codex "done" sessions (one-off override)

The normal `apply-thread-names.mjs` only archives threads that have **both** `stage=Done` and `manual_status=done`. For a cleanup pass where you're about to bulk-mark threads done, run this one-shot script first to archive all stage-Done sessions regardless of manual_status:

```bash
node -e "
const fs = require('fs'), os = require('os'), path = require('path');
const home = os.homedir();
const REGISTRY = '<path-to-active-threads.jsonl>';  // see scripts/lib/paths.mjs
const indexPath = path.join(home, '.codex', 'session_index.jsonl');
const archiveDir = path.join(home, '.codex', 'archived_sessions');

const records = fs.readFileSync(REGISTRY,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const archiveIds = new Map();
for (const r of records) {
  if (r.stage !== 'Done / Archive Candidates') continue;
  for (const s of r.sessions||[]) {
    if (s.harness==='Codex' && s.session_id) archiveIds.set(s.session_id, s.transcript_path||null);
  }
}
console.log('Sessions to archive:', archiveIds.size);

if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, {recursive:true});
let moved = 0;
for (const src of archiveIds.values()) {
  if (!src || !fs.existsSync(src)) continue;
  const dest = path.join(archiveDir, path.basename(src));
  if (!fs.existsSync(dest)) { try { fs.renameSync(src, dest); moved++; } catch {} }
}

const lines = fs.readFileSync(indexPath,'utf8').split('\n');
let archived = 0;
const out = [];
for (const line of lines) {
  if (!line.trim()) { out.push(line); continue; }
  let obj; try { obj = JSON.parse(line); } catch { out.push(line); continue; }
  if (archiveIds.has(obj.id)) { archived++; continue; }
  out.push(line);
}
if (archived) {
  const tmp = indexPath+'.tmp-'+process.pid;
  fs.writeFileSync(tmp, out.join('\n'), 'utf8');
  fs.renameSync(tmp, indexPath);
}
console.log('Archived from index:', archived, '| Moved rollout files:', moved);
"
```

After this, future normal runs of `apply-thread-names.mjs` will only archive threads that go through the proper `manual_status=done` gate.

---

## Step 3 — Triage the board

Open the board (run `npm start` in the repo, or read `active-threads.md` directly) and work through each non-Done stage:

### Decision rules

| Thread characteristics | Action |
|------------------------|--------|
| Single session, "Low evidence", unnamed (`Claude XXXX`, `Gemini 2026-XX-`) | Done — noise |
| Single session, lookup/Q&A ("How do I…", "What is…", "Can you find…") | Done — answered |
| Single session, one-off analysis (tax, finance, research) with no live follow-up | Done |
| Session >600h old, no follow-up session, topic superseded | Done |
| Session produced artifact (file/commit/skill) and it's confirmed in git | Done |
| Session produced artifact but push status unknown | Review/Ship — verify push |
| Session is genuinely in-progress, recent work exists | Keep at current stage |
| Windows-origin session (transcript path starts with `C:\`) | Can't read locally — leave or move to On Hold |

### Verify a push

```bash
# Did the session's claimed changes land in the repo?
git -C /path/to/repo log --oneline --since="<session-date>" --until="<session-date+2d>" -- <relevant-files>

# Or search by content
grep -r "<key-phrase>" /path/to/repo/src
```

---

## Step 4 — Bulk-mark Done

Write a list of thread IDs (from `active-threads.jsonl` or the board) and run the bulk-finish helper:

```bash
# One-shot helper — no permanent script needed
node -e "
const fs = require('fs');
const REGISTRY = '<path-to-active-threads.jsonl>';
const IDS = new Set([
  'thread_id_1',
  'thread_id_2',
  // ...
]);
const now = new Date().toISOString();
const records = fs.readFileSync(REGISTRY,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
let count = 0;
for (const r of records) {
  if (!IDS.has(r.thread_id)) continue;
  r.manual_stage = 'Done / Archive Candidates';
  r.manual_tracking = 'archive';
  r.manual_status = 'done';
  r.stage_changed_at = now;
  r.updated_at = now;
  count++;
}
fs.writeFileSync(REGISTRY, records.map(r=>JSON.stringify(r)).join('\n')+'\n','utf8');
console.log('Marked', count, 'of', IDS.size, 'threads as Done.');
"

# Then reconcile + rename
node scripts/reconcile-threads.mjs
node scripts/apply-thread-names.mjs
```

For individual threads, use the existing helper:

```bash
node scripts/edit-thread.mjs --match "<thread_id prefix or title>" --finish
```

---

## Step 5 — Final pass

```bash
# Reconcile and rename/archive in one go
node scripts/reconcile-threads.mjs && node scripts/apply-thread-names.mjs
```

Check the output — the `archived N from index` number tells you how many sessions were removed from the Codex resume picker.

---

## Registry path

The registry is shared across machines via Google Drive. Run `node scripts/lib/paths.mjs` (or check `resolveRegistryDir()` in `scripts/lib/paths.mjs`) to get the path on any machine.

```bash
node -e "import('./scripts/lib/paths.mjs').then(m => console.log(m.resolveRegistryDir()))"
```

---

## What to leave alone

- **Windows-origin sessions**: transcript paths start with `C:\` or `H:\` — not readable on Mac. Leave in place; run the cleanup from Windows to triage those.
- **On Hold threads**: deliberate parking — don't bulk-close these.
- **Cross-machine threads**: threads with sessions from multiple machines will re-surface on reconcile if the other machine's scan window covers them. That's correct — they'll just need a separate pass on that machine.
