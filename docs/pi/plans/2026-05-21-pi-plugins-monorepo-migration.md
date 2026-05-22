# Monorepo Workspace Migration and NPM Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the `pi-plugins` repository into a modern npm workspaces monorepo structure, allowing 5 selected plugins to be published individually to npm via Changesets and GitHub Actions with OIDC (Trusted Publisher), while keeping full backward compatibility for local `pi install .` and git installations.

**Architecture:** We use npm workspaces to split plugins into modular packages under `packages/`. To keep local installs (`pi install .`) and git-based installs fully backward compatible, the root `package.json`'s `"pi"` field explicitly maps both the remaining root resources (e.g. `browser-tools`, `grill-with-docs`) and the newly migrated workspace package resource folders. All occurrences of the deprecated `@mariozechner/pi-coding-agent` are upgraded to `@earendil-works/pi-coding-agent`.

**Tech Stack:** Node.js (v24), npm workspaces, @changesets/cli, GitHub Actions, OpenID Connect (OIDC) with npm Trusted Publisher and cryptographic build provenance.

---

### Task 1: Root Workspace Preparation and SDK Modernization

**Files:**

- Modify: `package.json`
- Modify: `extensions/browser-tools/index.ts`
- Modify: `tests/browser-tools/browser-session.spec.ts`
- Modify: `tests/browser-tools/package-manifest.spec.ts`
- Create: `.changeset/config.json`

- [ ] **Step 1: Update root package.json to declare workspaces, explicit pi paths, and modern devDependencies**

Modify `package.json` to configure npm workspaces, add changesets CLI, explicitly list all resources inside the `"pi"` config field, and upgrade the `@mariozechner/pi-coding-agent` dependency and peerDependency to `@earendil-works/pi-coding-agent` to align with modern SDK namespaces.

```json
{
  "name": "pi-plugins-workspace",
  "version": "0.1.0",
  "private": true,
  "description": "Monorepo workspace for selected shared Pi plugins.",
  "keywords": ["pi-package", "pi", "skills", "extensions", "prompts", "themes"],
  "license": "MIT",
  "workspaces": ["packages/*"],
  "pi": {
    "skills": [
      "./skills",
      "./packages/pi-plugin-migrate-to-agents-md/skills",
      "./packages/pi-plugin-audit-agents-md/skills",
      "./packages/pi-plugin-commit/skills",
      "./packages/pi-plugin-pr-findings/skills",
      "./packages/pi-plugin-dependency-audit/skills"
    ],
    "extensions": [
      "./extensions",
      "./packages/pi-plugin-pr-findings/extensions"
    ],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  },
  "scripts": {
    "setup": "npm install --no-audit --no-fund",
    "validate": "node scripts/validate-package.mjs",
    "validate:skills": "node scripts/validate-package.mjs --skills-only",
    "format": "prettier '**/*.{ts,js,cjs,md,json,yml,yaml}' --write",
    "changeset": "changeset",
    "changeset:version": "changeset version",
    "changeset:publish": "changeset publish"
  },
  "dependencies": {
    "puppeteer-core": "^23.11.1"
  },
  "devDependencies": {
    "@changesets/cli": "^2.29.6",
    "@earendil-works/pi-coding-agent": "0.75.1",
    "prettier": "^3.5.3"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

- [ ] **Step 2: Update SDK import in browser-tools extension**

Modify `extensions/browser-tools/index.ts` to use `@earendil-works/pi-coding-agent` instead of the deprecated `@mariozechner/pi-coding-agent`.

```typescript
// Modify import statement in extensions/browser-tools/index.ts:
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
```

- [ ] **Step 3: Update Mock namespace in browser-tools tests**

Modify `tests/browser-tools/browser-session.spec.ts` line 13 to mock the modern namespace:

```typescript
// Replace mock name:
jest.mock("@earendil-works/pi-coding-agent", () => ({}), { virtual: true });
```

- [ ] **Step 4: Update manifest expectations in package-manifest.spec.ts**

Modify `tests/browser-tools/package-manifest.spec.ts` to match the new root `package.json` layout.

```typescript
import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOT = join(__dirname, "..", "..");

describe("pi-plugins package manifest", () => {
  it("declares both extension and skill resources", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as {
      pi?: { extensions?: string[]; skills?: string[] };
      files?: string[];
    };

    expect(manifest.pi).toEqual({
      skills: [
        "./skills",
        "./packages/pi-plugin-migrate-to-agents-md/skills",
        "./packages/pi-plugin-audit-agents-md/skills",
        "./packages/pi-plugin-commit/skills",
        "./packages/pi-plugin-pr-findings/skills",
        "./packages/pi-plugin-dependency-audit/skills",
      ],
      extensions: [
        "./extensions",
        "./packages/pi-plugin-pr-findings/extensions",
      ],
      prompts: ["./prompts"],
      themes: ["./themes"],
    });
  });

  it("ships browser tool usage guidance as a skill", () => {
    const skillPath = join(PACKAGE_ROOT, "skills", "browser-tools", "SKILL.md");

    expect(existsSync(skillPath)).toBe(true);

    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toContain("name: browser-tools");
    expect(skill).toContain("browser_start");
    expect(skill).toContain("browser_nav");
    expect(skill).toContain("browser_eval");
    expect(skill).toContain("browser_screenshot");
    expect(skill).toContain("profile: true");
    expect(skill).toMatch(/prefer.*browser_eval/is);
  });
});
```

- [ ] **Step 5: Create Changeset Configuration**

Create `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 6: Run npm install to setup workspace symlinks and modern devDependencies**

Run command:
`npm install`

Expected output: `package-lock.json` updated with correct workspaces, modern SDK, changesets CLI, and prettier.

- [ ] **Step 7: Commit changes**

Run commands:

```bash
git add package.json package-lock.json .changeset/config.json extensions/browser-tools/index.ts tests/browser-tools/browser-session.spec.ts tests/browser-tools/package-manifest.spec.ts
git commit -m "chore: setup monorepo workspaces, changesets, and upgrade SDK namespace"
```

---

### Task 2: Migrate `migrate-to-agents-md` Plugin

**Files:**

- Create: `packages/pi-plugin-migrate-to-agents-md/package.json`
- Create: `packages/pi-plugin-migrate-to-agents-md/README.md`
- Move: `skills/migrate-to-agents-md/` to `packages/pi-plugin-migrate-to-agents-md/skills/migrate-to-agents-md/`

- [ ] **Step 1: Create package folder and move skill directory**

Run commands:

```bash
mkdir -p packages/pi-plugin-migrate-to-agents-md/skills
git mv skills/migrate-to-agents-md packages/pi-plugin-migrate-to-agents-md/skills/migrate-to-agents-md
```

- [ ] **Step 2: Create sub-package package.json**

Create `packages/pi-plugin-migrate-to-agents-md/package.json` enabling access public and cryptographically verifiable build provenance for security.

```json
{
  "name": "@sipgate/pi-plugin-migrate-to-agents-md",
  "version": "0.1.0",
  "description": "Pi skill to migrate agent instructions from CLAUDE.md to AGENTS.md",
  "keywords": ["pi-package"],
  "license": "MIT",
  "files": ["skills", "README.md"],
  "pi": {
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

- [ ] **Step 3: Create simple package README.md**

Create `packages/pi-plugin-migrate-to-agents-md/README.md`:

````markdown
# @sipgate/pi-plugin-migrate-to-agents-md

Pi skill to migrate agent instructions from CLAUDE.md to AGENTS.md.

## Install

```bash
pi install npm:@sipgate/pi-plugin-migrate-to-agents-md
```
````

## Usage

```text
/skill:migrate-to-agents-md
```

````

- [ ] **Step 4: Commit package migration**

Run commands:
```bash
git add packages/pi-plugin-migrate-to-agents-md
git commit -m "feat: migrate migrate-to-agents-md to workspaces"
````

---

### Task 3: Migrate `audit-agents-md` Plugin

**Files:**

- Create: `packages/pi-plugin-audit-agents-md/package.json`
- Create: `packages/pi-plugin-audit-agents-md/README.md`
- Move: `skills/audit-agents-md/` to `packages/pi-plugin-audit-agents-md/skills/audit-agents-md/`

- [ ] **Step 1: Create package folder and move skill directory**

Run commands:

```bash
mkdir -p packages/pi-plugin-audit-agents-md/skills
git mv skills/audit-agents-md packages/pi-plugin-audit-agents-md/skills/audit-agents-md
```

- [ ] **Step 2: Create sub-package package.json**

Create `packages/pi-plugin-audit-agents-md/package.json` enabling access public and cryptographically verifiable build provenance.

```json
{
  "name": "@sipgate/pi-plugin-audit-agents-md",
  "version": "0.1.0",
  "description": "Pi skill to audit AGENTS.md for clarity and safety rule violations",
  "keywords": ["pi-package"],
  "license": "MIT",
  "files": ["skills", "README.md"],
  "pi": {
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

- [ ] **Step 3: Create simple package README.md**

Create `packages/pi-plugin-audit-agents-md/README.md`:

````markdown
# @sipgate/pi-plugin-audit-agents-md

Pi skill to audit AGENTS.md for clarity and safety rule violations.

## Install

```bash
pi install npm:@sipgate/pi-plugin-audit-agents-md
```
````

## Usage

```text
/skill:audit-agents-md
```

````

- [ ] **Step 4: Commit package migration**

Run commands:
```bash
git add packages/pi-plugin-audit-agents-md
git commit -m "feat: migrate audit-agents-md to workspaces"
````

---

### Task 4: Migrate `commit` Plugin

**Files:**

- Create: `packages/pi-plugin-commit/package.json`
- Create: `packages/pi-plugin-commit/README.md`
- Move: `skills/commit/` to `packages/pi-plugin-commit/skills/commit/`

- [ ] **Step 1: Create package folder and move skill directory**

Run commands:

```bash
mkdir -p packages/pi-plugin-commit/skills
git mv skills/commit packages/pi-plugin-commit/skills/commit
```

- [ ] **Step 2: Create sub-package package.json**

Create `packages/pi-plugin-commit/package.json` enabling access public and cryptographically verifiable build provenance.

```json
{
  "name": "@sipgate/pi-plugin-commit",
  "version": "0.1.0",
  "description": "Interactive gitmoji-based commit skill with staged review for Pi",
  "keywords": ["pi-package"],
  "license": "MIT",
  "files": ["skills", "README.md"],
  "pi": {
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

- [ ] **Step 3: Create simple package README.md**

Create `packages/pi-plugin-commit/README.md`:

````markdown
# @sipgate/pi-plugin-commit

Interactive gitmoji-based commit skill with staged review for Pi.

## Install

```bash
pi install npm:@sipgate/pi-plugin-commit
```
````

## Usage

```text
/skill:commit
```

````

- [ ] **Step 4: Commit package migration**

Run commands:
```bash
git add packages/pi-plugin-commit
git commit -m "feat: migrate commit to workspaces"
````

---

### Task 5: Migrate `pr-findings` Plugin

**Files:**

- Create: `packages/pi-plugin-pr-findings/package.json`
- Create: `packages/pi-plugin-pr-findings/README.md`
- Move: `skills/pr-findings/` to `packages/pi-plugin-pr-findings/skills/pr-findings/`
- Move: `extensions/pr-findings/` to `packages/pi-plugin-pr-findings/extensions/pr-findings/`
- Modify: `packages/pi-plugin-pr-findings/extensions/pr-findings/index.ts`

- [ ] **Step 1: Create package directories and move folders**

Run commands:

```bash
mkdir -p packages/pi-plugin-pr-findings/skills packages/pi-plugin-pr-findings/extensions
git mv skills/pr-findings packages/pi-plugin-pr-findings/skills/pr-findings
git mv extensions/pr-findings packages/pi-plugin-pr-findings/extensions/pr-findings
```

- [ ] **Step 2: Update SDK import in index.ts to use modern @earendil-works namespace**

Modify `packages/pi-plugin-pr-findings/extensions/pr-findings/index.ts` line 1:

```typescript
// Replace this:
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// With this:
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
```

- [ ] **Step 3: Create sub-package package.json**

Create `packages/pi-plugin-pr-findings/package.json` enabling access public and cryptographically verifiable build provenance.

```json
{
  "name": "@sipgate/pi-plugin-pr-findings",
  "version": "0.1.0",
  "description": "Fetch and group GitHub PR review findings by severity in Pi",
  "keywords": ["pi-package"],
  "license": "MIT",
  "files": ["extensions", "skills", "README.md"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
```

- [ ] **Step 4: Create simple package README.md**

Create `packages/pi-plugin-pr-findings/README.md`:

````markdown
# @sipgate/pi-plugin-pr-findings

Fetch and group GitHub PR review findings by severity in Pi.

## Install

```bash
pi install npm:@sipgate/pi-plugin-pr-findings
```
````

## Usage

```text
/skill:pr-findings
```

````

- [ ] **Step 5: Commit package migration**

Run commands:
```bash
git add packages/pi-plugin-pr-findings
git commit -m "feat: migrate pr-findings to workspaces and update SDK import"
````

---

### Task 6: Migrate `dependency-audit` Plugin

**Files:**

- Create: `packages/pi-plugin-dependency-audit/package.json`
- Create: `packages/pi-plugin-dependency-audit/README.md`
- Move: `skills/dependency-audit/` to `packages/pi-plugin-dependency-audit/skills/dependency-audit/`
- Modify: `packages/pi-plugin-dependency-audit/skills/dependency-audit/SKILL.md`

- [ ] **Step 1: Create package folder and move skill files**

Run commands:

```bash
mkdir -p packages/pi-plugin-dependency-audit/skills
git mv skills/dependency-audit packages/pi-plugin-dependency-audit/skills/dependency-audit
```

- [ ] **Step 2: Update interactive shell wrapper documentation inside SKILL.md**

Modify `packages/pi-plugin-dependency-audit/skills/dependency-audit/SKILL.md` to note alternative installation paths when the plugin is installed via npm.

````markdown
// Update the wrapper documentation section to include:
To automatically run the security audit and launch the interactive selection menu every time you type `pi update` in your terminal:

**If installed via GitHub/Git (legacy):**

```bash
pi() {
    if [[ "$1" == "update" && ( -z "$2" || "$2" == "--extensions" ) ]]; then
        python3 ~/.pi/agent/git/github.com/testzugang/pi-plugins/skills/dependency-audit/scripts/pi-interactive-update.py
    else
        command pi "$@"
    fi
}
```
````

**If installed via npm:**

```bash
pi() {
    if [[ "$1" == "update" && ( -z "$2" || "$2" == "--extensions" ) ]]; then
        python3 ~/.pi/packages/node_modules/@sipgate/pi-plugin-dependency-audit/skills/dependency-audit/scripts/pi-interactive-update.py
    else
        command pi "$@"
    fi
}
```

````

- [ ] **Step 3: Create sub-package package.json**

Create `packages/pi-plugin-dependency-audit/package.json` enabling access public and cryptographically verifiable build provenance.

```json
{
  "name": "@sipgate/pi-plugin-dependency-audit",
  "version": "0.1.0",
  "description": "Static dependency and supply-chain malware auditing skill for Pi",
  "keywords": ["pi-package"],
  "license": "MIT",
  "files": [
    "skills",
    "README.md"
  ],
  "pi": {
    "skills": [
      "./skills"
    ]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  },
  "publishConfig": {
    "access": "public",
    "provenance": true
  }
}
````

- [ ] **Step 4: Create package README.md**

Create `packages/pi-plugin-dependency-audit/README.md`:

````markdown
# @sipgate/pi-plugin-dependency-audit

Static dependency and supply-chain malware auditing skill for Pi.

## Install

```bash
pi install npm:@sipgate/pi-plugin-dependency-audit
```
````

## Usage

```text
/skill:dependency-audit
```

## Interactive Terminal Integration (Wrapper)

See [SKILL.md](skills/dependency-audit/SKILL.md) for full instructions on setting up automated shell interception for security checks on `pi update`.

````

- [ ] **Step 5: Commit package migration**

Run commands:
```bash
git add packages/pi-plugin-dependency-audit
git commit -m "feat: migrate dependency-audit to workspaces and update doc paths"
````

---

### Task 7: Update Validation Script

**Files:**

- Modify: `scripts/validate-package.mjs`

- [ ] **Step 1: Update scripts/validate-package.mjs to support validation of both remaining root resources AND workspace packages**

Rewrite `scripts/validate-package.mjs` to keep validating root resources (to protect unmigrated plugins from regressions) while adding recursive schema, structure, description length, and keyword checking for all packages found in `packages/*`.

```javascript
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const skillsOnly = process.argv.includes("--skills-only");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
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
  return path.replace(/^\.\//, "");
}

// 1. Validate root-level resources listed in package.json (compatibility check)
if (!skillsOnly) {
  for (const key of ["skills", "extensions", "prompts", "themes"]) {
    const entries = packageJson.pi?.[key];
    if (!Array.isArray(entries) || entries.length === 0) {
      fail(`package.json pi.${key} must be a non-empty array`);
      continue;
    }

    for (const entry of entries) {
      const path = normalizeManifestPath(entry);
      if (!existsSync(path))
        fail(`package.json pi.${key} path does not exist: ${entry}`);
      else pass(`pi.${key}: ${entry}`);
    }
  }
}

// 2. Validate unmigrated root-level skills
const rootSkillsDir = "skills";
if (existsSync(rootSkillsDir)) {
  for (const entry of readdirSync(rootSkillsDir)) {
    const dir = join(rootSkillsDir, entry);
    if (!statSync(dir).isDirectory()) continue;

    const skillPath = join(dir, "SKILL.md");
    let content;
    try {
      content = readFileSync(skillPath, "utf8");
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
    const description = frontmatter[1]
      .match(/^description:\s*(.+)$/m)?.[1]
      ?.trim();

    if (!name) fail(`root skill ${entry}: missing name`);
    if (!description) fail(`root skill ${entry}: missing description`);
    if (name && name !== entry)
      fail(`root skill ${entry}: name '${name}' does not match directory`);
    if (name && !namePattern.test(name))
      fail(`root skill ${entry}: invalid skill name '${name}'`);
    if (description && description.length > 1024)
      fail(`root skill ${entry}: description exceeds 1024 characters`);

    if (name && description) pass(`validated root skill: ${name}`);
  }
}

// 3. Validate workspace packages
const packagesDir = "packages";
if (existsSync(packagesDir)) {
  const packages = readdirSync(packagesDir).filter((entry) =>
    statSync(join(packagesDir, entry)).isDirectory(),
  );

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg);
    const subPkgJsonPath = join(pkgPath, "package.json");

    if (!existsSync(subPkgJsonPath)) {
      fail(`workspace package ${pkg} is missing package.json`);
      continue;
    }

    let subPkgJson;
    try {
      subPkgJson = JSON.parse(readFileSync(subPkgJsonPath, "utf8"));
    } catch {
      fail(`failed to parse package.json for workspace ${pkg}`);
      continue;
    }

    if (!subPkgJson.name)
      fail(`workspace package ${pkg} package.json is missing 'name'`);
    if (!subPkgJson.version)
      fail(`workspace package ${pkg} package.json is missing 'version'`);
    if (!subPkgJson.keywords || !subPkgJson.keywords.includes("pi-package")) {
      fail(
        `workspace package ${pkg} package.json keywords must contain 'pi-package'`,
      );
    }

    // Validate sub-package resources point to existing folders
    if (!skillsOnly && subPkgJson.pi) {
      for (const key of ["skills", "extensions"]) {
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
    const subSkillsDir = join(pkgPath, "skills");
    if (existsSync(subSkillsDir)) {
      for (const skillEntry of readdirSync(subSkillsDir)) {
        const dir = join(subSkillsDir, skillEntry);
        if (!statSync(dir).isDirectory()) continue;

        const skillPath = join(dir, "SKILL.md");
        let content;
        try {
          content = readFileSync(skillPath, "utf8");
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
        const description = frontmatter[1]
          .match(/^description:\s*(.+)$/m)?.[1]
          ?.trim();

        if (!name) fail(`${pkg}/${skillEntry}: missing name`);
        if (!description) fail(`${pkg}/${skillEntry}: missing description`);
        if (name && name !== skillEntry)
          fail(`${pkg}/${skillEntry}: name '${name}' does not match directory`);
        if (name && !namePattern.test(name))
          fail(`${pkg}/${skillEntry}: invalid skill name '${name}'`);
        if (description && description.length > 1024)
          fail(`${pkg}/${skillEntry}: description exceeds 1024 characters`);

        if (name && description)
          pass(`validated workspace skill: ${pkg}/${name}`);
      }
    }
  }
}

if (failed) process.exit(1);
```

- [ ] **Step 2: Run validation locally to verify package structures and root resources**

Run command:
`npm run validate`

Expected output: Both root-level resources (like `browser-tools`) and workspace-level resources are validated successfully.

- [ ] **Step 3: Commit validation script updates**

Run commands:

```bash
git add scripts/validate-package.mjs
git commit -m "chore: update validation script to support both root and workspaces"
```

---

### Task 8: Set up CI/CD GitHub Action Release Workflow

**Files:**

- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create release pipeline using Changesets natively for secure, tokenless npm trusted publishing**

Create `.github/workflows/release.yml`. When running with `permissions: id-token: write`, npm OIDC trusted publishing is natively leveraged during `npm publish` via Changesets, eliminating long-lived credentials.

```yaml
name: Release

on:
  push:
    branches:
      - main

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm ci

      - name: Run validation
        run: npm run validate

      - name: Create release PR or publish
        uses: changesets/action@v1
        with:
          version: npm run changeset:version
          publish: npm run changeset:publish
          title: "chore: release packages"
          commit: "chore: release packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Commit release workflow**

Run commands:

```bash
git add .github/workflows/release.yml
git commit -m "ci: add OIDC changesets release workflow"
```

---

### Task 9: Update Root README.md for Monorepo & NPM Visibility

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update README.md to document the new monorepo layout and individual npm installations**

Update the root `README.md` to:

1. Explain the new directory structure (`packages/` containing modular packages, while `skills/` and `extensions/` contain unmigrated shared resources).
2. Clearly document how to install each of the 5 migrated plugins individually via npm.
3. Link to the workspace subfolders using clickable markdown links to improve discoverability and navigation.

Modify the "Install" section to include npm installations:

```markdown
### From npm (Individual packages)

The following selected plugins are published to npm and can be installed individually:

- **`migrate-to-agents-md`**: `pi install npm:@sipgate/pi-plugin-migrate-to-agents-md`
- **`audit-agents-md`**: `pi install npm:@sipgate/pi-plugin-audit-agents-md`
- **`commit`**: `pi install npm:@sipgate/pi-plugin-commit`
- **`pr-findings`**: `pi install npm:@sipgate/pi-plugin-pr-findings`
- **`dependency-audit`**: `pi install npm:@sipgate/pi-plugin-dependency-audit`
```

Update the "Repository layout" section to include `packages/`:

````markdown
## Repository layout

```text
pi-plugins/
  packages/               # Published independent npm packages (Monorepo Workspaces)
    pi-plugin-xxx/        # Package workspace containing its own package.json, SKILL.md and assets
  skills/                 # Remaining unmigrated shared Agent Skills (legacy root)
  extensions/             # Remaining unmigrated shared extensions (legacy root)
  prompts/                # Shared Prompt templates
  themes/                 # Shared TUI themes
  scripts/                # Shared validation and utility scripts
  tests/                  # Shared test suites and package-manifest checks
```
````

````

- [ ] **Step 2: Verify all markdown links inside the root README.md**

Check that links to skills like `[skills/dependency-audit/README.md](packages/pi-plugin-dependency-audit/README.md)` are updated to their correct new workspace locations, so that there are no broken links.

- [ ] **Step 3: Commit README.md updates**

Run commands:
```bash
git add README.md
git commit -m "docs: update root README to document monorepo structure and npm installation options"
````
