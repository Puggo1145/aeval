# YouEval Core Contracts (v1)

This document defines the frozen v1 contract after the task-run-first refactor.

## 1. Terms

1. `Suite`: task discovery and grouping definition.
2. `Task`: one evaluation scenario.
3. `Run`: one named provider parameter set inside a task.
4. `Trial`: one execution attempt of a run.

## 1.1 Object Taxonomy

1. Boundary contracts are versioned public shapes that cross IO or module boundaries.
2. Internal protocols are core-owned in-process payloads such as `TaskContext`, `RunEvent`, and validated runtime-only plain object types.
3. Domain objects stay as classes only when they add invariants or runtime behavior.

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
5. `parseSuiteDocument(input)` is the contract entrypoint for structural validation and is exposed as an optional tool API under `@youeval/core/tools`.

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
5. `parseTaskDocument(input)` is the contract entrypoint for structural validation and is exposed as an optional tool API under `@youeval/core/tools`

Built-in `llm-judge` layer config:

1. `config.dimension` is required and non-empty
2. `config.rubric` is required and non-empty
3. `config.assertions.length >= 1`
4. every `config.assertions[]` item is a non-empty string
5. `config.passThreshold` is required and must satisfy `0 < passThreshold <= 1`
6. `config.contextFrom` is optional and resolves against `ExecutionResult`
7. `config.judge.profile` is required and non-empty
8. Model/provider infrastructure is not part of task DSL; callers register the built-in `llm-judge` grader explicitly and inject AI SDK models for each profile at composition time

## 3. Runtime Contracts

### 3.1 TaskContext

```ts
type TaskContext = {
  taskId: string;
  trialIndex: number;
  runName: string;
  runId: string;
  signal: AbortSignal;
};
```

`TaskContext` is an internal protocol payload and is passed as a plain object.

### 3.2 Provider

```ts
interface Provider {
  readonly id: string;
  execute(ctx: TaskContext, run: Run): Promise<ExecutionResultInput>;
}
```

`run.params` is the selected run's parameter set.

`ExecutionResultInput` is the provider boundary shape. Core validates that input
and converts it into the internal plain-object `ExecutionResult` before grading
or orchestration continues.

`ExecutionResultData` remains the persisted `execution-result.v1` record shape
used in store-facing records.
`ExecutionResultData.metrics.latencyMs` means provider-reported execution
latency. It is distinct from the core-measured trial wall-clock duration.

Built-in `llm-judge` depends on a separate runtime contract:

```ts
interface JudgeProviderInput {
  output: string;
  rubric: string;
  assertions: string[];
  context?: unknown;
  dimension: string;
  judge: {
    profile: string;
  };
}
```

`JudgeProviderResult` returns a binary result per assertion, an averaged `score`,
an overall `reason`, and the resolved `profile`. Core stores the structured
assertion breakdown in `TrialGraderResult.result.meta`.

### 3.3 RunEvent

`RunEvent` is an internal protocol. Runtime exposes it as a plain
discriminated union, and consumers branch on the stable `type` discriminant.

```ts
type RunEvent =
  | { type: "run:started"; runId: string; taskId: string; runName: string; totalTrials: number }
  | { type: "trial:started"; taskId: string; runId: string; runName: string; trialIndex: number }
  | {
      type: "trial:completed";
      taskId: string;
      runId: string;
      runName: string;
      trialIndex: number;
      pass: boolean;
      durationMs: number;
    }
  | {
      type: "trial:error";
      taskId: string;
      runId: string;
      runName: string;
      trialIndex: number;
      errorType: "agent" | "system";
      message: string;
    }
  | { type: "run:completed"; summary: RunSummaryData };
```

Rules:

1. events are emitted in time order
2. `run:completed` is the last event for one run
3. `loadedSuite.streamTask(taskId)` emits one run lifecycle for each `provider.runs[]` entry

## 4. Tasks

```ts
interface Tasks {
  listSuites(): Promise<SuiteDescriptor[]>;
  resolveSuite(suiteId: string): Promise<ResolvedSuite>;
  resolveTask(taskRef: TaskRef): Promise<ResolvedTask>;
}
```

`ResolvedTask.source` must include:

1. `source.adapter`
2. `source.ref`
3. `source.revision`

Rules:

1. `tasks` owns suite/task discovery, source metadata, and raw document deserialization
2. provider/grader resolvability stays in Core
3. `ResolvedSuite.document` and `ResolvedTask.document` are raw adapter inputs
4. Core derives `TaskIndex` projections by resolving `taskRefs` into domain `Task` objects
5. `Suite.fromDocument(...)` and `Task.fromDocument(...)` are the only legal runtime construction paths
6. `ResolvedSuite.taskRefs[]` ordering is adapter-defined and is not a core contract guarantee

## 5. Core API

```ts
core.suites.list(): Promise<SuiteDescriptor[]>
core.suites.load(input): Promise<LoadedSuite>
core.suites.loadMany(...inputs): Promise<LoadedSuite[]>

core.results.list(): Promise<RunRecord[]>
core.results.getManifest(runId): Promise<RunManifestRecord | null>
core.results.getSummary(runId): Promise<RunSummaryData | null>
core.results.listTrials(runId): Promise<TrialRecord[]>
core.results.clearAll(): Promise<ClearedResultEntry[]>
core.results.clearByRunIds(runIds): Promise<ClearedResultEntry[]>

core.baseline.compare(currentRunId, options): Promise<BaselineComparison>

loadedSuite.listTasks(): Promise<TaskIndex[]>
loadedSuite.runTask(taskId): Promise<RunSummaryData[]>
loadedSuite.streamTask(taskId): AsyncIterable<RunEvent>
```

`Suite` is the pure suite definition/value object. `LoadedSuite` is the only
public execution handle and owns task listing plus task execution actions.

Rules:

1. `core.suites.load(input)` accepts a discovered suite id or a bare suite input object/promise
2. `runTask(taskId)` executes all runs defined by the task
3. runs are serial across `provider.runs[]`
4. trials may run concurrently within one run

Baseline rules:

1. `core.baseline.compare(currentRunId, options)` requires `options.baselineRunId`
2. Core must fail fast when the baseline run and current run belong to different tasks
3. `BaselineComparison` is a same-task delta shape:

```ts
interface BaselineComparison {
  taskId: string;
  baselineRunId: string;
  currentRunId: string;
  passRateDelta: number;
  passHatKDelta?: number;
  avgLatencyDelta?: number;
  tokenBudgetBreached?: boolean;
  verdict: "pass" | "regressed" | "improved";
}
```

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
4. `avgLatencyMs`, when present, is the average of provider-reported `execution.metrics.latencyMs`
5. `avgLatencyMs` must not be derived from `trial.timings.durationMs`

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
