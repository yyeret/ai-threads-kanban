import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { retireThreadCommands } from '../scripts/retire-thread-commands.mjs';

test('retirement preserves customized commands and backs up generated commands across harnesses', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-thread-commands-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const generated = [];
  for (const [directory, template, extension] of [['.claude/commands', 'claude.md', '.md'],
    ['.codex/prompts', 'codex.md', '.md'], ['.gemini/commands', 'gemini.toml', '.toml']]) {
    const target = path.join(home, directory, 'thread-state' + extension);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const source = fs.readFileSync(new URL('../skills/thread-state/commands/' + template, import.meta.url), 'utf8');
    if (template.endsWith('.md')) assert.match(source, /\u2014/);
    fs.writeFileSync(target, source.replaceAll('\r\n', '\n')
      .replaceAll('\u2014', '\u00e2\u20ac\u201d').replaceAll('\u00b7', '\u00c2\u00b7')
      .replaceAll('{{REPO_ROOT}}', 'C:\\Old workspace\\thread board').replaceAll('\n', '\r\n'));
    generated.push(target);
  }
  const custom = path.join(home, '.claude/commands/finish-thread.md');
  fs.writeFileSync(custom, 'My custom command\n');
  const result = retireThreadCommands(home);
  assert.deepEqual(result.removed.sort(), generated.sort());
  assert.deepEqual(result.preserved, [custom]);
  assert.equal(fs.readFileSync(custom, 'utf8'), 'My custom command\n');
  for (const target of generated) assert.equal(fs.existsSync(target), false);
  const backups = fs.readdirSync(path.join(home, '.config/ai-threads-kanban/retired-command-backups'));
  assert.equal(backups.length, 1);
  for (const directory of ['.claude/commands', '.codex/prompts', '.gemini/commands']) {
    assert.equal(fs.readdirSync(path.join(home, '.config/ai-threads-kanban/retired-command-backups', backups[0], directory)).length, 1);
  }
  assert.deepEqual(retireThreadCommands(home), { removed: [], preserved: [custom] });
});
