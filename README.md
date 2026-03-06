# YouEval

YouEval is a contract-first evaluation runtime for LLM and agent workflows.

The current v1 model is:

1. `suite` discovers and groups tasks.
2. `task` defines one evaluation scenario.
3. `task.provider.runs[]` defines the named parameter sets to execute for that task.
4. Selecting one task executes all of its runs, serially.

## Quickstart

### Prerequisites

- Node.js >= 20
- pnpm

### Install

```bash
pnpm install
pnpm build
pnpm test
```

### Run the basic TUI example

```bash
pnpm example:basic-llm
```

In the TUI, choose a suite, then a task. The selected task will execute every run declared in `provider.runs[]`.

## Core Terms

- `Suite`: task discovery scope and grouping.
- `Task`: one evaluation case.
- `Run`: one named provider parameter set inside a task.
- `Trial`: one execution attempt of a run.

## DSL

### Suite DSL

```yaml
schemaVersion: "suite.v1"
id: "basic-llm"
name: "Basic LLM Suite"
discover:
  - "datasets/**/*.yaml"
```

### Task DSL

```yaml
schemaVersion: "task.v1"
id: "chat-agent/smoke/capital-001"

provider:
  id: "basic-llm"
  runs:
    - name: "gpt-4o-mini"
      params:
        model: "gpt-4o-mini"
        prompt: "What is the capital of France?"
    - name: "gpt-5-mini"
      params:
        model: "gpt-5-mini"
        prompt: "What is the capital of France?"

graders:
  strategy: "ALL"
  layers:
    - name: "contains paris"
      type: "contains"
      config:
        mustInclude:
          - pattern: "Paris"
            caseSensitive: false

execution:
  timeoutMs: 30000
  retryOnError: 0
  trialsPerTask: 2
  maxConcurrency: 3
```

### `llm-judge` grader

`llm-judge` is a built-in grader for rubric-based semantic evaluation.
`registerBuiltinGraders(...)` does not auto-register it. Users explicitly create the built-in judge provider, then create/register the grader.

Task YAML only declares the judge model selection, not secrets:

```yaml
graders:
  strategy: "ALL"
  layers:
    - name: "llm quality judge"
      type: "llm-judge"
      config:
        dimension: "correctness"
        rubric: "Judge whether the answer is correct and grounded."
        assertions:
          - "The final answer directly addresses the user request."
          - "The answer does not invent facts not supported by context."
        passThreshold: 1
        contextFrom: "outcome.reference"
        judge:
          provider: "aihubmix"
          model: "gpt-4.1-mini"
```

Default application wiring for non-LLM graders is still one line:

```ts
registerBuiltinGraders(graderRegistry);
```

To use `llm-judge`, wire it explicitly:

```ts
registerBuiltinGraders(graderRegistry);

const judgeEnv = process.env;
const judgeProvider = createBuiltinLlmJudgeProvider({
  env: judgeEnv,
});

graderRegistry.register(
  'llm-judge',
  createLlmJudgeGrader(judgeProvider, {
    validateConfig: createBuiltinLlmJudgeConfigValidator(judgeEnv),
  }),
);
```

The built-in provider reads:

- `AIHUBMIX_API_KEY`

If a task selects `judge.provider: "aihubmix"` and `AIHUBMIX_API_KEY` is missing, the built-in config validator fails fast during task readiness validation.

If you need a non-built-in judge implementation, register it yourself with `graderRegistry.register(...)`, for example via `createLlmJudgeGrader(customJudgeProvider)`.

Never put API keys in task YAML, grader config, logs, or committed files.

## Provider Contract

```ts
type TaskProvider = (
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>
) => Promise<ExecutionResult>;
```

`TaskContext` contains:

- `taskId`
- `trialIndex`
- `runName`
- `runId`
- `signal`

Providers read only `params`.

## Core API

```ts
const core = createCore({
  taskSourceAdapter,
  resultStoreAdapter,
  providerRegistry,
  graderRegistry,
  runtimeDefaults: {
    maxConcurrency: 5,
  },
});

const suites = await core.listSuites();
const loadedSuite = await core.loadSuite(suites[0].id);
const tasks = await loadedSuite.listTasks();
const summaries = await loadedSuite.runTask(tasks[0].id);
```

Main entry points:

- `core.listSuites()`
- `core.loadSuite(input)` where `input` is a discovered suite id or a bare suite definition
- `core.loadSuites(...inputs)`
- `loadedSuite.listTasks()`
- `loadedSuite.runTask(taskId)`
- `loadedSuite.streamTask(taskId)`
- `core.listRuns()`
- `core.getRunManifest(runId)`
- `core.getRunSummary(runId)`
- `core.listTrials(runId)`

`core.listRuns()` returns stored runs whether they are completed or interrupted. Completed runs include a summary; interrupted runs remain manifest-only.

## Local Reference Adapters

`createLocalTaskSourceAdapter({ rootDir })` scans `rootDir` recursively for suite YAML files. `suite.discover[]` is resolved relative to that same `rootDir`.

`createLocalResultStoreAdapter({ rootDir })` stores one directory per run with manifest, summary, and trial records.

## Examples

- [`examples/basic-llm-test`](/Users/puggo/Desktop/work/youeval/examples/basic-llm-test)
- [`examples/file-edit-agent`](/Users/puggo/Desktop/work/youeval/examples/file-edit-agent)

Both examples use bare-object `suite.v1` and `task.v1` YAML documents with task-level `provider.runs[]`. Suite and task files may be colocated if `discover[]` points at the right paths.
