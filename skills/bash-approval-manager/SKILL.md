---
name: bash-approval-manager
description: "Audit, clean, and simulate the rule-matching of pi-bash-approval whitelist rules. Use when a command is unexpectedly blocked, when you want to verify if a new regex rule is secure, or to clean up duplicates and redundant rules from ~/.pi/agent/.bash-approval."
---

# Bash Approval Manager

Specialized assistant skill to audit, clean, and simulate whitelist patterns for the `pi-bash-approval` extension. Helps developers manage prompt fatigue, keep rules minimal, and prevent security vulnerabilities (such as command injection).

## Capabilities

1.  **Security & Quality Audit**: Scan `~/.pi/agent/.bash-approval` for:
    *   Syntactically invalid regular expressions.
    *   Security risks (e.g. unanchored rules, greedy `.*` wildcards).
    *   Use of obsolete, vulnerable path pattern formulas (recommends the new injection-proof `PATH_PATTERN`).
    *   Duplicate or redundant rule definitions.
2.  **Automatic Cleanup**: Removes exact duplicates and redundant literal rules (literals already covered by broader regex or glob rules) with automatic backup creation.
3.  **Command Simulation**: Explains step-by-step why a specific shell command is allowed or blocked, showing exactly which whitelist line matched which segment.

## Usage

All features are provided by the bundled cross-platform Node utility script `scripts/manager.mjs`.

### 1. Run Security and Quality Audit
Scan your current whitelist for security risks, syntactical errors, duplicates, and redundant entries:
```bash
node skills/bash-approval-manager/scripts/manager.mjs audit
```

### 2. Auto-Clean Duplicates and Redundancies
Clean up your `.bash-approval` file automatically. This removes exact duplicates and redundant literal rules (and creates a safety backup of your original file!):
```bash
node skills/bash-approval-manager/scripts/manager.mjs clean
```

### 3. Simulate Matching and Splitting
Simulate how the bash-approval interceptor evaluates a given command. This shows segment-by-segment matches or blocks:
```bash
node skills/bash-approval-manager/scripts/manager.mjs simulate "git -C siblings/ai-agents-playground status"
```

## Agent Workflows

When the user asks you to inspect, verify, debug, or clean their bash-approval rules, use the following steps:

1.  **Identify the Goal**: Determine if they want to find out why a command was blocked (use `simulate`), clean up rules (use `clean`), or check for security vulnerabilities (use `audit`).
2.  **Run the Utility**: Execute the corresponding subcommand via the `bash` tool.
3.  **Synthesize Results**: Present findings to the user. On auditing, explain what each warning means and give direct suggestions on how to improve the regex.
