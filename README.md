# YouEval
The evaluation system for YouMind AI capabilities.

This repository is currently in an early stage. We keep docs lightweight and evolve them continuously.

## What This Project Is
1. Contract-first eval runtime.
2. Outcome-first grading (not only text output).
3. Core-first architecture with clear adapter abstractions.

## Current Stage
1. Early design and contract alignment.
2. Tasks are treated as external data sources and loaded via `TaskSourceAdapter`.
3. External platform adapter integrations are deferred behind core milestones.
4. Standalone run means local/reference adapters are available, not adapter-free runtime.

## Docs Map
1. Onboarding: [AGENTS.md](./AGENTS.md)
2. Full architecture and rationale: [DESIGN.md](./DESIGN.md)
3. Contract baseline: [docs/core-contracts-v1.md](./docs/core-contracts-v1.md)
4. Implementation roadmap: [docs/core-v1-implementation-plan.md](./docs/core-v1-implementation-plan.md)

## Milestone 0 Quickstart
1. Build CLI:
   - `pnpm -C apps/youeval build`
2. Show help:
   - `node apps/youeval/dist/cli.js --help`
3. Try a placeholder command:
   - `node apps/youeval/dist/cli.js run`
4. Try an unknown command:
   - `node apps/youeval/dist/cli.js unknown`

## Notes
1. Milestone 0 only provides a placeholder CLI and unified error handling.
2. When scope changes, update `AGENTS.md` and `DESIGN.md` first.
3. Adapter-specific docs are not part of current required reading.
