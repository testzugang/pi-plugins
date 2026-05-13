---
name: handoff
description: "Use when you need to compact the current conversation into a document for another agent or session. Summarizes context, decisions, and next steps."
---

# Session Handoff

Compact the current conversation into a handoff document.

**Reference:** Based on the `handoff` skill from [mattpocock/skills](https://github.com/mattpocock/skills).

## Process

1.  **Summarize Context**: Briefly explain what was being worked on.
2.  **Key Decisions**: List major decisions made in this session.
3.  **Next Steps**: What should the next agent/session focus on?
4.  **Artifact References**: Link to relevant PRDs, specs, ADRs, or commits. Do not duplicate their content.
5.  **Skill Recommendations**: Suggest which skills the next agent should use.

## Usage

Write the handoff to a temporary file or a dedicated `handoff.md` (check project preferences).

```bash
# Example: Create a temporary handoff
mktemp -t handoff-XXXXXX.md
```

**Note**: Focus on what isn't already captured in git or dedicated documentation files.
