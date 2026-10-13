import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['thread-state', 'finish-thread', 'track-thread'];
const targets = [['.claude/commands', 'claude.md', '.md'],
  ['.codex/prompts', 'codex.md', '.md'], ['.gemini/commands', 'gemini.toml', '.toml']];
const normalize = (text) => text.replaceAll('\r\n', '\n').trim();
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function retireThreadCommands(home = os.homedir()) {
  const removed = [];
  const preserved = [];
  const stamp = new Date().toISOString().replaceAll(':', '-');
  for (const [directory, templateName, extension] of targets) {
    for (const name of names) {
      const target = path.join(home, directory, name + extension);
      if (!fs.existsSync(target)) continue;
      const template = normalize(fs.readFileSync(path.join(repo, 'skills', name, 'commands', templateName), 'utf8'));
      const pattern = new RegExp('^' + template.split('{{REPO_ROOT}}').map(escape).join('[^\\r\\n]+?') + '$');
      const content = fs.readFileSync(target, 'utf8');
      if (!pattern.test(normalize(content))) {
        preserved.push(target);
        continue;
      }
      const backup = path.join(home, '.config', 'ai-threads-kanban', 'retired-command-backups', stamp, directory, name + extension);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(target, backup);
      fs.unlinkSync(target);
      removed.push(target);
    }
  }
  return { removed, preserved };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(retireThreadCommands(), null, 2));
}
