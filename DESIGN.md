# YouEval Design

YouEval is an evaluation runtime for Agent systems.

## 1. Scope

The project is still under development. We keep the model small and avoid compatibility layers for deprecated execution shapes.

## 2. Semantic Model

- `Suite`: discovery scope for tasks / collection of tasks.
- `Task`: one evaluation definition.
- `Run`: one named provider parameter set inside a task.
- `Trial`: one execution attempt of a run.

General execution process:

1. User selects a suite.
2. User selects a task inside that suite.
3. Core resolves the task once.
4. Core executes every `task.provider.runs[]` entry, serially.
5. Trials within one run may execute concurrently for multiple times.

## 3. Architecture

### 3.1 Layers

Core
  - domain
  - contracts
  - validation
  - orchestrator
  - provider/grader containers
  - query/baseline APIs

Adapters
  - tasks
  - stores
  - observers
  - interfaces

### 3.2 Dependency Direction

1. Core owns evaluation semantics.
2. Adapters implement IO boundaries only.
3. Providers and graders are resolved through containers injected into Core.
4. Interfaces consumes Core APIs only.
5. `contracts` own suite/task schemas; `Suite` and `Task` domain factories call those parsers internally and remain the only legal construction path for runtime suite/task objects.
6. Built-in adapters, graders, and TUI (interface) are treated like external modules for boundary control.
7. Public package surfaces are limited to `@youeval/core`, `@youeval/core/tools`, `@youeval/graders`, `@youeval/adapter-task-source-local`, `@youeval/adapter-result-store-local`, `@youeval/adapter-observer-console`, and `@youeval/interface-tui`.
8. `core/domain`, `core/runtime`, `core/orchestrator`, `core/utils`, and `core/validation` remain internal implementation layers.
9. Parser/schema entrypoints are optional tool capabilities. Runtime composition does not require callers to parse DSL documents themselves; when exposed publicly, they live under `@youeval/core/tools`.

### 3.3 Object Taxonomy

1. Boundary contracts are versioned public shapes that cross IO or module boundaries, such as DSL documents, persisted result records, and provider input contracts.
2. Internal protocols are core-owned in-process payloads such as `TaskContext`, `RunEvent`, and other validated runtime-only plain object types; they stay as plain object types or discriminated unions.
3. Domain objects remain classes only when they carry invariants, lifecycle transitions, or derived runtime behavior.

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
3. `discover[]` is resolved relative to `new LocalTask({ rootDir })`.

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

Built-in `llm-judge` uses `layers[].config` to declare a rubric, `assertions[]`,
`passThreshold`, optional `contextFrom`, and a `judge { profile }` selector.
Model infra is not part of the task DSL; callers explicitly create the
built-in judge provider at composition time and inject AI SDK model instances
there.

## 5. Runtime

### 5.1 Provider Contract

```ts
interface Provider {
  readonly id: string;
  execute(ctx: TaskContext, run: Run): Promise<ExecutionResultInput>;
}
```

`TaskContext` is an internal protocol payload carried as a plain object. It contains `taskId`, `trialIndex`, `runName`, `runId`, and `signal`.

Providers receive the selected `Run` object and the execution context.

Providers return `ExecutionResultInput`, an external boundary shape that Core
does not trust directly. Core validates and normalizes that input into the
internal plain-object `ExecutionResult` before grading or persistence.

Persisted result records use `ExecutionResultData`, the versioned
`execution-result.v1` store shape emitted by Core when writing adapter-facing
records. `ExecutionResultData.metrics.latencyMs` means provider-reported
execution latency. It is distinct from `Trial.timings.durationMs`, which is the
core-measured wall-clock duration for the full trial lifecycle.

Built-in graders may depend on extra runtime wiring. `llm-judge` is wired
explicitly by the caller: register `new BuiltinLlmJudgeGrader(...)` on
`graders`. `registerBuiltinGraders(...)` only registers the pure built-in
graders that need no extra runtime dependencies. Custom judge providers are
still registered directly through `new LlmJudgeGrader(customJudgeProvider)`.

`RunEvent` is also an internal protocol type. Runtime streams emit plain
discriminated-union event objects rather than domain classes.

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
`avgLatencyMs` is emitted only from provider-reported `execution.metrics.latencyMs`
values and never from core `Trial.timings.durationMs`.

## 6. Tasks Boundary

`Tasks` is the discovery and resolution boundary:

```ts
interface Tasks {
  listSuites(): Promise<SuiteDescriptor[]>;
  resolveSuite(suiteId: string): Promise<ResolvedSuite>;
  resolveTask(taskRef: TaskRef): Promise<ResolvedTask>;
}
```

`ResolvedTask.source` carries adapter provenance fields: `adapter`, `ref`, and `revision`.

Responsibilities:

1. discover suites
2. resolve suite task refs and source metadata
3. resolve one raw task document with source metadata
4. keep adapter work to IO and raw deserialization; Core derives `TaskIndex` views from resolved task documents

Provider and grader resolvability stays in Core, not in the adapter.

## 7. Core API

```ts
new Core({ tasks, stores, providers, graders, observers })

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

`Suite` is the pure suite definition/value object inside Core. `LoadedSuite` is
the public execution handle returned by `core.suites.load(...)`; it binds suite
metadata to task projection and task execution behavior without mutating the
domain `Suite`.

`core.suites.load` accepts either:

1. a suite id discovered through `tasks`
2. a bare suite input object or promise that resolves to one; `Suite.fromDocument(...)` validates it during load

Baseline comparison is run-to-run within one task only:

1. `core.baseline.compare(...)` requires an explicit `baselineRunId`
2. comparing runs from different tasks fails fast
3. `BaselineComparison` reports same-task metric deltas and verdict only

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
3. Keep adapter content/provenance deterministic and fail-fast; task/suite ordering is caller-owned.
4. Avoid compatibility layers for removed DSLs.
