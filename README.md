# AEval

AEval is an agent evaluation framework. It runs evaluation tasks, executes one or
more provider runs, grades the outputs, and stores trial results.

The core model is:

1. `suite`: a discovery scope for tasks.
2. `task`: one evaluation scenario.
3. `task.provider.runs[]`: one or more named parameter sets for the provider.
4. `trial`: one execution attempt for a run.

## Install

For a normal local evaluation setup with YAML tasks, local result storage, built-in
graders, and the TUI, install:

```bash
pnpm add @aeval/core @aeval/graders \
  @aeval/adapter-task-source-local \
  @aeval/adapter-result-store-local \
  @aeval/adapter-observer-console \
  @aeval/interface-tui
```

If you only want to embed the runtime and provide your own task source, result
store, UI, and graders, start with:

```bash
pnpm add @aeval/core
```

Optional packages:

- `@aeval/graders`: built-in graders such as `contains`, `regex`, `json-schema`,
  `token-budget`, and `llm-judge`.
- `@aeval/adapter-task-source-local`: load `suite.v1` and `task.v1` YAML files from
  disk.
- `@aeval/adapter-result-store-local`: persist run manifests, summaries, and trials
  to local files.
- `@aeval/adapter-observer-console`: print run events to the console.
- `@aeval/interface-tui`: run a local interactive task picker.

## Minimal Example

This is the smallest useful local setup: one provider, one YAML suite, one YAML
task, built-in graders, local results, and the TUI.

Project layout:

```text
my-evals/
  main.ts
  datasets/
    basic-llm-test/
      suite.yaml
      task-001-capital-france.yaml
```

`main.ts`:

```ts
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConsoleObserver } from '@aeval/adapter-observer-console';
import { LocalStore } from '@aeval/adapter-result-store-local';
import { LocalTask } from '@aeval/adapter-task-source-local';
import {
  Core,
  type ExecutionResultInput,
  type Provider,
  type Run,
  type TaskContext,
} from '@aeval/core';
import { builtinGraders } from '@aeval/graders';
import { runTui } from '@aeval/interface-tui';

const currentDir = dirname(fileURLToPath(import.meta.url));

class BasicProvider implements Provider {
  readonly id = 'basic-llm';

  async execute(_ctx: TaskContext, run: Run): Promise<ExecutionResultInput> {
    const prompt = run.params.prompt;
    if (typeof prompt !== 'string' || prompt.length === 0) {
      throw new Error("Provider param 'prompt' must be a non-empty string.");
    }

    return {
      output: 'Paris',
      trace: {
        turns: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: 'Paris' },
        ],
      },
      metrics: {
        latencyMs: 1,
      },
    };
  }
}

async function main(): Promise<void> {
  const core = new Core({
    tasks: new LocalTask({ rootDir: currentDir }),
    stores: new LocalStore({ rootDir: resolve(currentDir, 'results') }),
    providers: [new BasicProvider()],
    graders: [...builtinGraders],
    observers: [new ConsoleObserver()],
  });

  await runTui(core);
}

void main();
```

`datasets/basic-llm-test/suite.yaml`:

```yaml
schemaVersion: "suite.v1"
id: "basic-llm"
name: "Basic LLM Example"
discover:
  - "datasets/basic-llm-test/**/*.yaml"
```

`datasets/basic-llm-test/task-001-capital-france.yaml`:

```yaml
schemaVersion: "task.v1"
id: "basic-llm/smoke/capital-france-001"

provider:
  id: "basic-llm"
  runs:
    - name: "default"
      params:
        prompt: "What is the capital of France?"

graders:
  strategy: "ALL"
  layers:
    - name: "must contain Paris"
      type: "contains"
      config:
        mustInclude:
          - pattern: "Paris"
            caseSensitive: false

execution:
  timeoutMs: 30000
  retryOnError: 0
  trialsPerTask: 1
  maxConcurrency: 1
```

Run it:

```bash
pnpm tsx main.ts
```

The TUI will let you choose the suite and task, run the provider, grade the
output, and write result files under `results/`.

## Real Provider Example

The repository includes a fuller example in
`examples/basics/main.ts`. It wires:

- `BasicLlmProvider`, which calls a real LLM through the AI SDK.
- `FileEditAgentProvider`, which evaluates a simple file-editing agent.
- `BuiltinLlmJudgeGrader`, which uses a configured judge model for `llm-judge`
  grading layers.

Run the repository example:

```bash
pnpm install
pnpm build
pnpm example:basics
```

The real LLM example expects a `.env` file under `examples/basics/` with:

```dotenv
DEEPSEEK_API_KEY=...
```
