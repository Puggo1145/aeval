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
5. `parseSuiteDocument(input)` is the contract entrypoint for structural validation.

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
5. `parseTaskDocument(input)` is the contract entrypoint for structural validation

Built-in `llm-judge` layer config:

1. `config.dimension` is required and non-empty
2. `config.rubric` is required and non-empty
3. `config.assertions.length >= 1`
4. every `config.assertions[]` item is a non-empty string
5. `config.passThreshold` is required and must satisfy `0 < passThreshold <= 1`
6. `config.contextFrom` is optional and resolves against `ExecutionResult`
7. `config.judge.provider` must be `aihubmix`
8. `config.judge.model` is required and non-empty
9. API keys are not part of task DSL; callers register the built-in `llm-judge` grader explicitly and may source `AIHUBMIX_API_KEY` from environment variables

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
interface Provider {
  readonly id: string;
  execute(ctx: TaskContext, run: Run): Promise<ExecutionResult>;
}
```

`run.params` is the selected run's parameter set.

Built-in `llm-judge` depends on a separate runtime contract:

```ts
interface JudgeProviderInput {
  output: string;
  rubric: string;
  assertions: string[];
  context?: unknown;
  dimension: string;
  judge: {
    provider: 'aihubmix';
    model: string;
  };
}
```

`JudgeProviderResult` returns a binary result per assertion, an averaged `score`,
and an overall `reason`. Core stores the structured assertion breakdown in
`TrialGraderResult.result.meta`.

### 3.3 RunEvent

Runtime exposes `RunEvent` as a plain discriminated union.
Consumers branch on the stable `type` discriminant and fields below:

```ts
type RunEvent =
  | RunStartedEvent
  | TrialStartedEvent
  | TrialCompletedEvent
  | TrialErrorEvent
  | RunCompletedEvent;

class RunStartedEvent {
  readonly type = "run:started";
  constructor(
    readonly runId: string,
    readonly taskId: string,
    readonly runName: string,
    readonly totalTrials: number,
  );
}

class TrialStartedEvent {
  readonly type = "trial:started";
  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly runName: string,
    readonly trialIndex: number,
  );
}

class TrialCompletedEvent {
  readonly type = "trial:completed";
  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly runName: string,
    readonly trialIndex: number,
    readonly pass: boolean,
    readonly durationMs: number,
  );
}

class TrialErrorEvent {
  readonly type = "trial:error";
  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly runName: string,
    readonly trialIndex: number,
    readonly errorType: "agent" | "system",
    readonly message: string,
  );
}

class RunCompletedEvent {
  readonly type = "run:completed";
  constructor(readonly summary: RunSummaryData);
}
```

Rules:

1. events are emitted in time order
2. `run:completed` is the last event for one run
3. `suite.streamTask(taskId)` emits one run lifecycle for each `provider.runs[]` entry

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
4. `source.fetchedAt`

Rules:

1. `tasks` owns suite/task discovery and structural validation
2. `tasks` produces deterministic task ordering
3. duplicate `task.id` inside one resolved suite fail fast
4. provider/grader resolvability stays in Core
5. `Task` and `Suite` constructors re-parse incoming documents and reject invalid runtime state immediately

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

core.baseline.set(runId): Promise<void>
core.baseline.compare(currentRunId, options?): Promise<BaselineComparison>

loadedSuite.listTasks(): Promise<TaskIndex[]>
loadedSuite.runTask(taskId): Promise<RunSummaryData[]>
loadedSuite.streamTask(taskId): AsyncIterable<RunEvent>
```

Rules:

1. `core.suites.load(input)` accepts a discovered suite id or a bare suite object/promise
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
