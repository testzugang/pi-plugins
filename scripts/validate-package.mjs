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

// 1. Validate root-level resources listed in package.json (compatibility check)
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

// 2. Validate unmigrated root-level skills
const rootSkillsDir = 'skills';
if (existsSync(rootSkillsDir)) {
  for (const entry of readdirSync(rootSkillsDir)) {
    const dir = join(rootSkillsDir, entry);
    if (!statSync(dir).isDirectory()) continue;

    const skillPath = join(dir, 'SKILL.md');
    let content;
    try {
      content = readFileSync(skillPath, 'utf8');
    } catch {
      fail(`root skill ${entry}: missing SKILL.md`);
      continue;
    }

    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) {
      fail(`root skill ${entry}: missing YAML frontmatter`);
      continue;
    }

    const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();

    if (!name) fail(`root skill ${entry}: missing name`);
    if (!description) fail(`root skill ${entry}: missing description`);
    if (name && name !== entry) fail(`root skill ${entry}: name '${name}' does not match directory`);
    if (name && !namePattern.test(name)) fail(`root skill ${entry}: invalid skill name '${name}'`);
    if (description && description.length > 1024) fail(`root skill ${entry}: description exceeds 1024 characters`);

    if (name && description) pass(`validated root skill: ${name}`);
  }
}

// 3. Validate workspace packages
const packagesDir = 'packages';
if (existsSync(packagesDir)) {
  const packages = readdirSync(packagesDir).filter(entry => 
    statSync(join(packagesDir, entry)).isDirectory()
  );

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg);
    const subPkgJsonPath = join(pkgPath, 'package.json');
    
    if (!existsSync(subPkgJsonPath)) {
      fail(`workspace package ${pkg} is missing package.json`);
      continue;
    }

    let subPkgJson;
    try {
      subPkgJson = JSON.parse(readFileSync(subPkgJsonPath, 'utf8'));
    } catch {
      fail(`failed to parse package.json for workspace ${pkg}`);
      continue;
    }

    if (!subPkgJson.name) fail(`workspace package ${pkg} package.json is missing 'name'`);
    if (!subPkgJson.version) fail(`workspace package ${pkg} package.json is missing 'version'`);
    if (!subPkgJson.keywords || !subPkgJson.keywords.includes('pi-package')) {
      fail(`workspace package ${pkg} package.json keywords must contain 'pi-package'`);
    }

    // Validate sub-package resources point to existing folders
    if (!skillsOnly && subPkgJson.pi) {
      for (const key of ['skills', 'extensions']) {
        const entries = subPkgJson.pi[key];
        if (!entries) continue;
        if (!Array.isArray(entries)) {
          fail(`${pkg}: pi.${key} must be an array`);
          continue;
        }
        for (const entry of entries) {
          const resolvedPath = join(pkgPath, entry);
          if (!existsSync(resolvedPath)) {
            fail(`${pkg}: pi.${key} path does not exist: ${entry}`);
          }
        }
      }
    }

    // Validate SKILL.md for each skill inside this package
    const subSkillsDir = join(pkgPath, 'skills');
    if (existsSync(subSkillsDir)) {
      for (const skillEntry of readdirSync(subSkillsDir)) {
        const dir = join(subSkillsDir, skillEntry);
        if (!statSync(dir).isDirectory()) continue;

        const skillPath = join(dir, 'SKILL.md');
        let content;
        try {
          content = readFileSync(skillPath, 'utf8');
        } catch {
          fail(`${pkg}/${skillEntry}: missing SKILL.md`);
          continue;
        }

        const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatter) {
          fail(`${pkg}/${skillEntry}: missing YAML frontmatter`);
          continue;
        }

        const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
        const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();

        if (!name) fail(`${pkg}/${skillEntry}: missing name`);
        if (!description) fail(`${pkg}/${skillEntry}: missing description`);
        if (name && name !== skillEntry) fail(`${pkg}/${skillEntry}: name '${name}' does not match directory`);
        if (name && !namePattern.test(name)) fail(`${pkg}/${skillEntry}: invalid skill name '${name}'`);
        if (description && description.length > 1024) fail(`${pkg}/${skillEntry}: description exceeds 1024 characters`);

        if (name && description) pass(`validated workspace skill: ${pkg}/${name}`);
      }
    }
  }
}

if (failed) process.exit(1);
