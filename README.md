# YouEval
The evaluation infra for YouMind AI capabilities.

This repository is currently in an early stage. We keep docs lightweight and evolve them continuously.

## What This Project Is
1. Contract-first eval runtime.
2. Outcome-first grading (not only text output).
3. Core-first architecture with clear adapter abstractions.

## Quickstart

### Prerequisites

- Node.js >= 20
- pnpm

### Install & Build

```bash
pnpm install
pnpm build
```

### Run the smoke experiment

```bash
YOUEVAL_DATASETS_ROOT=.datasets node --import tsx src/cli.ts run \
  --experiment experiments/chat-agent-smoke.yaml --run smoke

# Reuse for all following commands in this shell
export YOUEVAL_DATASETS_ROOT=.datasets
```

### View results

```bash
# List all runs
node --import tsx src/cli.ts runs

# Show run summary
node --import tsx src/cli.ts report <runId>

# Show individual trials
node --import tsx src/cli.ts trials <runId>
```

### Baseline management

```bash
# Set a run as baseline
node --import tsx src/cli.ts baseline set <runId>

# Compare a run against the baseline
node --import tsx src/cli.ts baseline compare <runId>
```

## Docs Map
1. Onboarding: [AGENTS.md](./AGENTS.md)
2. Full architecture and rationale: [DESIGN.md](./DESIGN.md)
3. Contract baseline: [docs/core-contracts-v1.md](./docs/core-contracts-v1.md)
4. Implementation roadmap: [docs/core-v1-implementation-plan.md](./docs/core-v1-implementation-plan.md)
