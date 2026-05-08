import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const skillsOnly = process.argv.includes('--skills-only');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
let failed = false;

function fail(message) {
  failed = true;
  console.error(`✗ ${message}`);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function normalizeManifestPath(path) {
  return path.replace(/^\.\//, '');
}

if (!skillsOnly) {
  for (const key of ['skills', 'extensions', 'prompts', 'themes']) {
    const entries = packageJson.pi?.[key];
    if (!Array.isArray(entries) || entries.length === 0) {
      fail(`package.json pi.${key} must be a non-empty array`);
      continue;
    }

    for (const entry of entries) {
      const path = normalizeManifestPath(entry);
      if (!existsSync(path)) fail(`package.json pi.${key} path does not exist: ${entry}`);
      else pass(`pi.${key}: ${entry}`);
    }
  }
}

const skillsDir = 'skills';
if (!existsSync(skillsDir)) {
  fail('missing skills directory');
} else {
  for (const entry of readdirSync(skillsDir)) {
    const dir = join(skillsDir, entry);
    if (!statSync(dir).isDirectory()) continue;

    const skillPath = join(dir, 'SKILL.md');
    let content;
    try {
      content = readFileSync(skillPath, 'utf8');
    } catch {
      fail(`${entry}: missing SKILL.md`);
      continue;
    }

    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) {
      fail(`${entry}: missing YAML frontmatter`);
      continue;
    }

    const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();

    if (!name) fail(`${entry}: missing name`);
    if (!description) fail(`${entry}: missing description`);
    if (name && name !== entry) fail(`${entry}: name '${name}' does not match directory`);
    if (name && !namePattern.test(name)) fail(`${entry}: invalid skill name '${name}'`);
    if (description && description.length > 1024) fail(`${entry}: description exceeds 1024 characters`);

    if (name && description) pass(`skill: ${name}`);
  }
}

if (failed) process.exit(1);
