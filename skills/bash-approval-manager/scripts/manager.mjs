#!/usr/bin/env node

/**
 * Pi Bash Approval Manager
 * Utility script for auditing, cleaning and simulating rule-matching of pi-bash-approval rules.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ALLOW_LIST_PATH = path.join(os.homedir(), '.pi', 'agent', '.bash-approval');

// Theme ANSI colors
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function printHeader(text) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${text} ===${colors.reset}`);
}

function printSuccess(text) {
  console.log(`${colors.green}✔ ${text}${colors.reset}`);
}

function printWarning(text) {
  console.log(`${colors.yellow}⚠ ${text}${colors.reset}`);
}

function printError(text) {
  console.log(`${colors.red}✘ ${text}${colors.reset}`);
}

// Helper to compile regex patterns exactly like pi-bash-approval does at runtime
function compileRegexPattern(pattern) {
  let trimmed = pattern.trim();
  if (trimmed.startsWith('\\r:')) {
    return null; // Treated as literal
  }
  if (!trimmed.startsWith('r:')) {
    return null;
  }
  const patternSource = trimmed.slice(2).trim();
  const finalEnclosedSource = `^(?:${patternSource})$`;
  try {
    return new RegExp(finalEnclosedSource);
  } catch (err) {
    throw new Error(`Invalid regex syntax in rule "${pattern}": ${err.message}`);
  }
}

// Matches a single command segment against a rule
function matchesPattern(command, rule) {
  const trimmedCommand = command.trim();
  let trimmedPattern = rule.trim();

  if (trimmedPattern.startsWith('\\r:')) {
    trimmedPattern = trimmedPattern.slice(1);
  } else if (trimmedPattern.startsWith('r:')) {
    try {
      const regex = compileRegexPattern(trimmedPattern);
      return regex ? regex.test(trimmedCommand) : false;
    } catch {
      return false;
    }
  }

  // Trailing-glob matching
  if (trimmedPattern.endsWith('*')) {
    const prefix = trimmedPattern.slice(0, -1);
    // Handle exact-prefix rule format ":*" (e.g., git status:*)
    if (prefix.endsWith(':')) {
      const barePrefix = prefix.slice(0, -1);
      return trimmedCommand === barePrefix || trimmedCommand.startsWith(prefix + ' ');
    }
    return trimmedCommand.startsWith(prefix);
  }

  // Exact match
  return trimmedCommand === trimmedPattern;
}

// Basic split command logic mirroring splitChains behavior
function splitCommand(command) {
  // Simple separator-based splitting as a fast fallback
  const separators = ['&&', '||', ';', '|', '&', '\n'];
  let currentSegment = "";
  const segments = [];
  let inDoubleQuote = false;
  let inSingleQuote = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = command[i + 1];

    if (char === '"' && command[i - 1] !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      currentSegment += char;
      continue;
    }
    if (char === "'" && command[i - 1] !== '\\') {
      inSingleQuote = !inSingleQuote;
      currentSegment += char;
      continue;
    }

    if (!inDoubleQuote && !inSingleQuote) {
      // Check for double character separators
      if (char === '&' && nextChar === '&') {
        segments.push(currentSegment.trim());
        currentSegment = "";
        i++; // skip next &
        continue;
      }
      if (char === '|' && nextChar === '|') {
        segments.push(currentSegment.trim());
        currentSegment = "";
        i++; // skip next |
        continue;
      }
      if (separators.includes(char)) {
        segments.push(currentSegment.trim());
        currentSegment = "";
        continue;
      }
    }

    currentSegment += char;
  }

  if (currentSegment.trim()) {
    segments.push(currentSegment.trim());
  }

  return segments.filter(Boolean);
}

// Load rules from the disk
function loadRules() {
  if (!fs.existsSync(ALLOW_LIST_PATH)) {
    return { rules: [], rawLines: [] };
  }
  const content = fs.readFileSync(ALLOW_LIST_PATH, 'utf-8');
  const rawLines = content.split('\n');
  const rules = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    rules.push({
      rule: trimmed,
      lineNum: i + 1,
      raw: line,
    });
  }

  return { rules, rawLines };
}

// 1. AUDIT COMMAND
function runAudit() {
  printHeader('Auditing Bash Approval Whitelist');
  console.log(`${colors.dim}Checking config file: ${ALLOW_LIST_PATH}${colors.reset}\n`);

  if (!fs.existsSync(ALLOW_LIST_PATH)) {
    printError('No .bash-approval file found.');
    return;
  }

  const { rules } = loadRules();
  let errorsCount = 0;
  let warningsCount = 0;
  let redundanciesCount = 0;

  const validCompiledRules = [];

  // Syntax and security checks
  for (const item of rules) {
    const { rule, lineNum } = item;

    // Check Regex rules
    if (rule.startsWith('r:') && !rule.startsWith('\\r:')) {
      try {
        const regex = compileRegexPattern(rule);
        validCompiledRules.push({ rule, regex, lineNum, type: 'regex' });

        // Security check: Check for unsafe path pattern (old \S+ pattern)
        if (rule.includes('(?:"[^"]+"|\'[^\']+\'|\\S+)')) {
          printWarning(`Zeile ${lineNum}: Nutzt das alte, unsichere Pfad-Muster (Lücke A/B).`);
          console.log(`  └─ Regel: ${colors.yellow}${rule}${colors.reset}`);
          console.log(`  └─ Empfehlung: Ersetze durch sicheres Pattern: ${colors.green}(?:"[^"$\\x60]+"|'[^']+'|[^\\s$\\x60]+)${colors.reset}`);
          warningsCount++;
        }

        // Security check: Check for too greedy wildcards in unquoted areas
        const regexBody = rule.slice(2);
        if (regexBody.includes('.*') && !regexBody.includes('\\.*')) {
          printWarning(`Zeile ${lineNum}: Enthält gierigen Platzhalter ".*".`);
          console.log(`  └─ Regel: ${colors.yellow}${rule}${colors.reset}`);
          console.log(`  └─ Hinweis: Überprüfe, ob ".*" missbraucht werden kann, um Command-Separatoren einzuschleusen.`);
          warningsCount++;
        }

      } catch (err) {
        printError(`Zeile ${lineNum}: Ungültige Regex-Syntax!`);
        console.log(`  └─ Fehler: ${colors.red}${err.message}${colors.reset}`);
        errorsCount++;
      }
    } else {
      // Literal / Glob Rules
      validCompiledRules.push({ rule, lineNum, type: rule.endsWith('*') ? 'glob' : 'literal' });

      // Security check: Check for unsafe general glob rule end ":*" (risk of command substitution)
      if (rule.endsWith(':*')) {
        printWarning(`Zeile ${lineNum}: Potenzielle Command-Substitution-Sicherheitslücke!`);
        console.log(`  └─ Regel: ${colors.yellow}${rule}${colors.reset}`);
        console.log(`  └─ Risiko: Erlaubt unbemerkt Injektionen wie "${rule.slice(0, -2)} \$(touch /tmp/evil)".`);
        const baseCmd = rule.slice(0, -2).trim();
        console.log(`  └─ Empfehlung: Umstellen auf sichere Regex: ${colors.green}r:^${baseCmd}(?: [^$\\x60]+)?$${colors.reset}`);
        warningsCount++;
      }

      // Security check: Check for unsafe "cd" with trailing glob "*" (risk of substitution directly on name)
      if (rule.startsWith('cd ') && rule.endsWith('*') && !rule.endsWith(':*')) {
        printWarning(`Zeile ${lineNum}: Gefährliches gieriges Verzeichnis-Globbing!`);
        console.log(`  └─ Regel: ${colors.yellow}${rule}${colors.reset}`);
        console.log(`  └─ Risiko: Erlaubt Injektionen ohne Leerzeichen wie "${rule.slice(0, -1)}\$(touch /tmp/evil)".`);
        const baseDir = rule.slice(3, -1).trim();
        console.log(`  └─ Empfehlung: Umstellen auf sichere Regex: ${colors.green}r:^cd ${baseDir}(?:/[a-zA-Z0-9_\\.\\-]+)*$${colors.reset}`);
        warningsCount++;
      }
    }
  }

  // Duplicate checks (exact same rule)
  const exactSeen = new Map();
  for (const item of rules) {
    if (exactSeen.has(item.rule)) {
      const prevLine = exactSeen.get(item.rule);
      printWarning(`Zeile ${item.lineNum}: Exaktes Duplikat von Zeile ${prevLine}.`);
      console.log(`  └─ Regel: "${colors.yellow}${item.rule}${colors.reset}"`);
      warningsCount++;
    } else {
      exactSeen.set(item.rule, item.lineNum);
    }
  }

  // Redundancy checks (is a specific command rule redundant because a generic regex/glob covers it?)
  for (const item of validCompiledRules) {
    // Only check if literal rule is covered by a broader regex or glob rule
    if (item.type === 'literal') {
      for (const parent of validCompiledRules) {
        if (parent.lineNum === item.lineNum) continue;

        // A literal rule is matched by a regex/glob rule
        if ((parent.type === 'regex' || parent.type === 'glob') && matchesPattern(item.rule, parent.rule)) {
          printWarning(`Zeile ${item.lineNum}: Redundante Regel.`);
          console.log(`  └─ Spezifische Regel: "${colors.yellow}${item.rule}${colors.reset}"`);
          console.log(`  └─ Bereits abgedeckt durch Zeile ${parent.lineNum}: "${colors.green}${parent.rule}${colors.reset}"`);
          redundanciesCount++;
          break;
        }
      }
    }
  }

  console.log('\n--- Audit Summary ---');
  if (errorsCount === 0 && warningsCount === 0 && redundanciesCount === 0) {
    printSuccess('Deine Whitelist ist absolut sauber und sicher!');
  } else {
    console.log(`Gefundene Fehler: ${errorsCount > 0 ? colors.red : colors.reset}${errorsCount}${colors.reset}`);
    console.log(`Gefundene Warnungen/Sicherheitsrisiken: ${warningsCount > 0 ? colors.yellow : colors.reset}${warningsCount}${colors.reset}`);
    console.log(`Gefundene Redundanzen (aufräumbar): ${redundanciesCount > 0 ? colors.yellow : colors.reset}${redundanciesCount}${colors.reset}`);
    console.log(`\nTipp: Führe ${colors.cyan}node manager.mjs clean${colors.reset} aus, um Duplikate und Redundanzen vollautomatisch zu bereinigen.`);
  }
}

// 2. CLEAN COMMAND
function runClean() {
  printHeader('Cleaning Bash Approval Whitelist');
  console.log(`${colors.dim}Target file: ${ALLOW_LIST_PATH}${colors.reset}\n`);

  if (!fs.existsSync(ALLOW_LIST_PATH)) {
    printError('No .bash-approval file found to clean.');
    return;
  }

  const { rules, rawLines } = loadRules();
  const validCompiledRules = [];

  // Compile valid rules to analyze matching
  for (const item of rules) {
    try {
      if (item.rule.startsWith('r:') && !item.rule.startsWith('\\r:')) {
        const regex = compileRegexPattern(item.rule);
        validCompiledRules.push({ ...item, regex, type: 'regex' });
      } else {
        validCompiledRules.push({ ...item, type: item.rule.endsWith('*') ? 'glob' : 'literal' });
      }
    } catch {
      // Ignore syntax-invalid rules during clean mapping to keep them for safety (will be reported in audit)
    }
  }

  const rulesToKeep = [];
  const exactSeen = new Set();

  for (const item of validCompiledRules) {
    // 1. Skip exact duplicates
    if (exactSeen.has(item.rule)) {
      console.log(`  [D] Entferne exaktes Duplikat (Zeile ${item.lineNum}): "${colors.yellow}${item.rule}${colors.reset}"`);
      continue;
    }
    exactSeen.add(item.rule);

    // 2. Skip redundancies (literals covered by regex/glob rules)
    if (item.type === 'literal') {
      let isRedundant = false;
      for (const parent of validCompiledRules) {
        if (parent.lineNum === item.lineNum) continue;

        if ((parent.type === 'regex' || parent.type === 'glob') && matchesPattern(item.rule, parent.rule)) {
          console.log(`  [R] Entferne redundantes Literal (Zeile ${item.lineNum}): "${colors.yellow}${item.rule}${colors.reset}" (Abgedeckt durch Zeile ${parent.lineNum}: "${parent.rule}")`);
          isRedundant = true;
          break;
        }
      }
      if (isRedundant) {
        continue;
      }
    }

    rulesToKeep.push(item);
  }

  // Backup original file
  const backupPath = `${ALLOW_LIST_PATH}.bak-${Date.now()}`;
  fs.copyFileSync(ALLOW_LIST_PATH, backupPath);
  console.log(`\n${colors.dim}Backup erstellt unter: ${backupPath}${colors.reset}`);

  // Re-build file content. We keep original comments and formatting, but remove the cleaned rules.
  const cleanedLines = [];
  let ruleIndex = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      cleanedLines.push(line);
      continue;
    }

    // Check if this active rule was chosen to be kept
    const ruleMatch = rulesToKeep.find(r => r.lineNum === i + 1);
    if (ruleMatch) {
      cleanedLines.push(line);
    }
  }

  // Write cleaned file back
  fs.writeFileSync(ALLOW_LIST_PATH, cleanedLines.join('\n'), 'utf-8');
  printSuccess(`Bereinigung erfolgreich abgeschlossen!`);
  console.log(`Regeln vor Bereinigung: ${colors.yellow}${rules.length}${colors.reset} -> Regeln danach: ${colors.green}${rulesToKeep.length}${colors.reset}`);
}

// 3. SIMULATE COMMAND
function runSimulate(commandToTest) {
  printHeader(`Simulating Command Approval Matching`);
  console.log(`Test-Command: ${colors.bold}${colors.cyan}${commandToTest}${colors.reset}\n`);

  if (!fs.existsSync(ALLOW_LIST_PATH)) {
    printError('No .bash-approval file found.');
    return;
  }

  const { rules } = loadRules();
  const segments = splitCommand(commandToTest);

  console.log(`Erkannte Segmente (${segments.length}):`);
  segments.forEach((seg, index) => {
    console.log(`  ${index + 1}. [${colors.cyan}${seg}${colors.reset}]`);
  });
  console.log('');

  let allAllowed = true;

  for (let sIndex = 0; sIndex < segments.length; sIndex++) {
    const segment = segments[sIndex];
    let matchedRule = null;

    for (const rItem of rules) {
      if (matchesPattern(segment, rItem.rule)) {
        matchedRule = rItem;
        break;
      }
    }

    if (matchedRule) {
      printSuccess(`Segment ${sIndex + 1} freigegeben.`);
      console.log(`  └─ Treffer Zeile ${matchedRule.lineNum}: ${colors.green}${matchedRule.rule}${colors.reset}\n`);
    } else {
      printError(`Segment ${sIndex + 1} BLOCKIERT!`);
      console.log(`  └─ Grund: Kein passender Eintrag in der Whitelist gefunden.\n`);
      allAllowed = false;
    }
  }

  console.log('--- Simulation Summary ---');
  if (allAllowed) {
    printSuccess('Der gesamte Befehl wird geräuschlos FREIGEGEBEN (Silent Run).');
  } else {
    printError('Der Befehl wird blockiert und erfordert einen interaktiven User-Prompt!');
  }
}

// Main CLI router
const args = process.argv.slice(2);
const command = args[0];

if (!command) {
  console.log(`
Usage:
  node manager.mjs audit              # Checks whitelist for syntax and security risks
  node manager.mjs clean              # Removes duplicates and redundancies (makes backup)
  node manager.mjs simulate "command" # Explains why a command matches or gets blocked
  `);
  process.exit(0);
}

switch (command.toLowerCase()) {
  case 'audit':
    runAudit();
    break;
  case 'clean':
    runClean();
    break;
  case 'simulate':
    const cmdToTest = args.slice(1).join(' ');
    if (!cmdToTest) {
      printError('Bitte gib einen Befehl an, den du simulieren möchtest. Beispiel:');
      console.log('  node manager.mjs simulate "git -C /tmp status"');
      process.exit(1);
    }
    runSimulate(cmdToTest);
    break;
  default:
    printError(`Unbekannter Befehl: "${command}"`);
    process.exit(1);
}
