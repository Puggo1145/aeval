# YouEval Core Contracts (v1)

This document defines the frozen v1 contract after the task-run-first refactor.

## 1. Terms

1. `Suite`: task discovery and grouping definition.
2. `Task`: one evaluation scenario.
3. `Run`: one named provider parameter set inside a task.
4. `Trial`: one execution attempt of a run.

## 2. DSL Contracts

### 2.1 Suite DSL

Required fields:

1. `schemaVersion = "suite.v1"`
2. `id`
3. `name`
4. `discover[]`

Validation rules:

1. Only `suite.v1` is accepted.
2. `discover.length >= 1`.
3. `discover[]` contains only non-empty strings.
4. Unknown fields fail fast.

### 2.2 Task DSL

Required fields:

1. `schemaVersion = "task.v1"`
2. `id`
3. `provider.id`
4. `provider.runs[]`
5. `graders.strategy`
6. `graders.layers[]`
7. `execution.timeoutMs`

Standardized optional fields:

1. `desc`
2. `category`
3. `capability`
4. `tier`
5. `difficulty`
6. `tags`
7. `lifecycle`
8. `trackedMetrics`
9. `execution.retryOnError`
10. `execution.trialsPerTask`
11. `execution.maxConcurrency`

Provider run rules:

1. `provider.runs.length >= 1`
2. `provider.runs[].name` is required and unique within the task
3. `provider.runs[].params` must be an object
4. every run carries a complete parameter set
5. there is no provider-level default `params`

Execution rules:

1. `execution.timeoutMs > 0`
2. `execution.retryOnError >= 0` when present
3. `execution.trialsPerTask > 0` when present
4. `execution.maxConcurrency > 0` when present

Grader rules:

1. `graders.layers.length >= 1`
2. `WEIGHTED` requires `passThreshold`
3. `WEIGHTED` requires every layer to define `weight`
4. unknown fields fail fast

## 3. Runtime Contracts

### 3.1 TaskContext

```ts
interface TaskContext {
  taskId: string;
  trialIndex: number;
  runName: string;
  runId: string;
  signal: AbortSignal;
}
```

### 3.2 Provider

```ts
type TaskProvider = (
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>
) => Promise<ExecutionResult>;
```

`params` is the selected run's `params`.

### 3.3 RunEvent

```ts
type RunEvent =
  | { type: "run:started"; runId: string; taskId: string; runName: string; totalTrials: number }
  | { type: "trial:started"; taskId: string; runId: string; runName: string; trialIndex: number }
  | { type: "trial:completed"; taskId: string; runId: string; runName: string; trialIndex: number; pass: boolean; durationMs: number }
  | { type: "trial:error"; taskId: string; runId: string; runName: string; trialIndex: number; errorType: "agent" | "system"; message: string }
  | { type: "run:completed"; summary: RunSummary };
```

Rules:

1. events are emitted in time order
2. `run:completed` is the last event for one run
3. `loadedSuite.streamTask(taskId)` emits one run lifecycle for each `provider.runs[]` entry

## 4. Task Source Adapter

```ts
interface TaskSourceAdapter {
  listSuites(): Promise<SuiteDescriptor[]>;
  resolveSuite(suiteId: string): Promise<ResolvedSuite>;
  resolveTask(taskRef: TaskRef): Promise<ResolvedTask>;
}
```

`ResolvedTask` must include:

1. `source.adapter`
2. `source.ref`
3. `source.revision`
4. `source.fetchedAt`
5. `task`

Rules:

1. adapters own suite/task discovery and structural validation
2. adapters produce deterministic task ordering
3. duplicate `task.id` inside one resolved suite fail fast
4. provider/grader resolvability stays in Core

## 5. Core API

```ts
core.listSuites(): Promise<SuiteDescriptor[]>
core.loadSuite(input): Promise<LoadedSuite>
core.loadSuites(...inputs): Promise<LoadedSuite[]>

loadedSuite.listTasks(): Promise<TaskIndex[]>
loadedSuite.runTask(taskId): Promise<RunSummary[]>
loadedSuite.streamTask(taskId): AsyncIterable<RunEvent>
```

Rules:

1. `loadSuite` accepts a discovered suite id or a bare suite object/promise
2. `runTask(taskId)` executes all runs defined by the task
3. runs are serial across `provider.runs[]`
4. trials may run concurrently within one run

## 6. Result Contracts

### 6.1 RunManifest

```ts
interface RunManifest {
  schemaVersion: "run-manifest.v1";
  runId: string;
  suiteId: string;
  suiteName: string;
  taskId: string;
  runName: string;
  taskSource: {
    adapter: string;
    ref: string;
    revision: string;
  };
  taskHash: string;
  configHash: string;
  startedAt: string;
  completedAt?: string;
}
```

### 6.2 RunSummary

```ts
interface RunSummary {
  schemaVersion: "run-summary.v1";
  runId: string;
  taskId: string;
  runName: string;
  totalTrials: number;
  passRate: number;
  passAtK?: number;
  passHatK?: number;
  avgLatencyMs?: number;
}
```

Rules:

1. `passRate = passedTrials / totalTrials`
2. `passAtK` is present only when `totalTrials > 1`; when present, it is `1` if any trial passes, otherwise `0`
3. `passHatK` is present only when `totalTrials > 1`; when present, it is `1` if all trials pass, otherwise `0`

## 7. Hashing Rules

`taskHash` is computed in Core from the canonical validated task object.

`configHash` is computed from:

1. `task.id`
2. `task.provider.id`
3. `selectedRun.name`
4. `selectedRun.params`
5. `effectiveExecution.timeoutMs`
6. `effectiveExecution.retryOnError`
7. `effectiveExecution.trialsPerTask`
8. `effectiveExecution.maxConcurrency`

Pure display metadata such as `suite.name` is excluded.
