# YouEval Design

## 1. Scope

YouEval is a core-first evaluation runtime for LLM and agent systems.

Current scope:

1. Suite-based task discovery.
2. Task-level multi-run execution.
3. Local reference adapters for task source and result storage.
4. TUI as the v1 interactive interface.

The project is still early-stage. We keep the model small and avoid compatibility layers for deprecated execution shapes.

## 2. Semantic Model

- `Suite`: discovery scope for tasks.
- `Task`: one evaluation definition.
- `Run`: one named provider parameter set inside a task.
- `Trial`: one execution attempt of a run.

Execution rule:

1. User selects a suite.
2. User selects a task inside that suite.
3. Core resolves the task once.
4. Core executes every `task.provider.runs[]` entry, serially.
5. Trials within one run may execute concurrently, bounded by `maxConcurrency`.

## 3. Architecture

### 3.1 Layers

```text
Core
  - contracts
  - validation
  - orchestrator
  - runtime registries
  - query/baseline APIs

Adapters
  - task source
  - result store
  - observer

Interfaces
  - TUI
```

### 3.2 Dependency Direction

1. Core owns evaluation semantics.
2. Adapters implement IO boundaries only.
3. Providers and graders are resolved through registries injected into Core.
4. TUI consumes Core APIs only. It does not call adapters directly.

## 4. DSL

### 4.1 Suite

`suite.v1` only declares discovery:

```yaml
schemaVersion: "suite.v1"
id: "basic-llm"
name: "Basic LLM Suite"
discover:
  - "datasets/**/*.yaml"
```

Rules:

1. `discover[]` is required.
2. Unknown fields fail fast.
3. `discover[]` is resolved relative to the local task source adapter `rootDir`.

### 4.2 Task

`task.v1` defines provider runs, graders, and execution policy:

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

Rules:

1. `provider.runs[]` is required and non-empty.
2. `provider.runs[].name` is unique within the task.
3. `provider.runs[].params` is the complete parameter set for that run.
4. There is no provider-level default `params`.
5. Unknown fields fail fast.

## 5. Runtime

### 5.1 Provider Contract

```ts
type TaskProvider = (
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>
) => Promise<ExecutionResult>;
```

`TaskContext` contains `taskId`, `trialIndex`, `runName`, `runId`, and `signal`.

Providers receive only the selected run params and the execution context.

### 5.2 Concurrency and Timeout

1. `maxConcurrency` counts concurrent trials.
2. Effective priority is `task.execution.maxConcurrency > core.runtimeDefaults.maxConcurrency > 5`.
3. `timeoutMs` is task-scoped.
4. `retryOnError` is task-scoped.
5. Timeout is treated as a `system` error and is not retried by default.

### 5.3 Result Model

Each task run is a first-class run record:

- one `runId`
- one manifest
- one summary
- one or more trial records

`passRate` remains task-run level and is computed as `passedTrials / totalTrials`.
`passAtK` is emitted only when `totalTrials > 1`; when emitted, it is `1` if any trial passes, otherwise `0`.
`passHatK` is emitted only when `totalTrials > 1`; when emitted, it is `1` if all trials pass, otherwise `0`.

## 6. Task Source Boundary

`TaskSourceAdapter` is the discovery and resolution boundary:

```ts
interface TaskSourceAdapter {
  listSuites(): Promise<SuiteDescriptor[]>;
  resolveSuite(suiteId: string): Promise<ResolvedSuite>;
  resolveTask(taskRef: TaskRef): Promise<ResolvedTask>;
}
```

Responsibilities:

1. discover suites
2. resolve suite task indexes
3. resolve one task with source metadata
4. strict structural validation

Provider and grader resolvability stays in Core, not in the adapter.

## 7. Core API

```ts
core.listSuites(): Promise<SuiteDescriptor[]>
core.loadSuite(input): Promise<LoadedSuite>
core.loadSuites(...inputs): Promise<LoadedSuite[]>

loadedSuite.listTasks(): Promise<TaskIndex[]>
loadedSuite.runTask(taskId): Promise<RunSummary[]>
loadedSuite.streamTask(taskId): AsyncIterable<RunEvent>
```

`loadSuite` accepts either:

1. a suite id discovered through the task source adapter
2. a bare suite object or promise that resolves to one

## 8. TUI

The TUI flow is:

1. choose suite
2. choose task
3. stream task execution
4. inspect stored runs, summaries, and trials

Results views include interrupted runs that have a manifest but no completed summary yet.

Runtime display uses `taskId + runName + trialIndex`.

## 9. Design Constraints

1. Keep the orchestration boundary narrow.
2. Prefer task-level execution primitives over suite-level batch abstractions.
3. Keep adapters deterministic and fail-fast.
4. Avoid compatibility layers for removed DSLs.
