---
name: improve-codebase-architecture
description: "Use when you want to surface architectural friction and propose deepening opportunities (turning shallow modules into deep ones). Informed by CONTEXT.md and ADRs. Aimed at testability and AI-navigability."
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones.

**Reference:** Based on the `improve-codebase-architecture` skill from [mattpocock/skills](https://github.com/mattpocock/skills).

## Core Vocabulary

- **Module**: Anything with an interface and an implementation.
- **Interface**: Everything a caller must know (types, invariants, errors, config).
- **Implementation**: The code inside.
- **Depth**: High leverage (lots of behavior behind a small interface).
- **Shallow**: Interface nearly as complex as the implementation.
- **Seam**: Where an interface lives; behavior can be altered without editing in place.
- **Leverage**: What callers get from depth.
- **Locality**: Concentration of change, bugs, and knowledge.

## Process

1.  **Explore**: Read `CONTEXT.md` and ADRs. Use `subagent({ agent: 'scout' })` to walk the codebase and find friction points.
2.  **Deletion Test**: Imagine deleting a module. If complexity vanishes, it's a pass-through (shallow). If it reappears across callers, it's earning its keep.
3.  **Present Candidates**: Numbered list of opportunities (Files, Problem, Solution, Benefits).
4.  **Grilling Loop**: Walk the design tree for the chosen candidate. Update `CONTEXT.md` or offer ADRs as needed.

## Supporting Docs

- [Language Definitions](LANGUAGE.md)
- [Deepening Opportunities](DEEPENING.md)
- [Interface Design Guidelines](INTERFACE-DESIGN.md)
