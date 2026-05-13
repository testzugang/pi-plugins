---
name: grill-with-docs
description: "Use when you need to stress-test a plan against the project's existing domain model (CONTEXT.md) and architectural decisions (ADRs). Challenges terminology, aligns with canonical language, and updates documentation inline."
---

# Grill with Docs

Specialized grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (`CONTEXT.md`, ADRs) inline as decisions crystallize.

**Reference:** Based on the `grill-with-docs` skill from [mattpocock/skills](https://github.com/mattpocock/skills).

## Process

1.  **Domain Awareness**: Before grilling, use `scout` or `read` to find existing documentation.
    *   Look for `CONTEXT.md` (glossary) and `docs/adr/` (Architectural Decision Records).
    *   If `CONTEXT-MAP.md` exists, the repo has multiple contexts; locate the relevant one.
2.  **Interview Relentlessly**: Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
3.  **Challenge against the Glossary**: If a term conflicts with `CONTEXT.md`, call it out immediately.
4.  **Sharpen Fuzzy Language**: Propose precise canonical terms (e.g., "Customer" vs "User").
5.  **Cross-reference with Code**: Verify if the code agrees with the stated plan.
6.  **Update Inline**: Update `CONTEXT.md` and create ADRs (sparingly) as decisions are made.

## Documentation Formats

- [ADR Format](ADR-FORMAT.md)
- [Context/Glossary Format](CONTEXT-FORMAT.md)

## ADR Criteria

Only offer to create an ADR when all three are true:
1.  **Hard to reverse** — high cost of changing later.
2.  **Surprising without context** — future readers will wonder "why?".
3.  **Real trade-off** — there were genuine alternatives.

## Red Flags

- "We can fix the terminology later" -> No, sharpen it now.
- "I'll update CONTEXT.md at the end" -> No, update it inline.
- Creating ADRs for obvious or easily reversible decisions.
