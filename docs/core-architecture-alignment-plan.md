# Core Architecture Alignment Plan

Status: proposed

## 1. Goal

This document aligns the next core cleanup work after v1.

The primary goal is to make `core` boundaries legible and consistent:

1. Keep real boundary contracts explicit.
2. Keep true runtime/domain objects small but meaningful.
3. Avoid turning internal protocol messages into unnecessary classes.
4. Remove duplicate parsing and awkward mixed responsibilities.

## 2. Current Problems

The current codebase has three different kinds of objects mixed under the words
`contract` and `domain`:

1. Boundary data contracts:
   - `SuiteDocument`
   - `TaskDocument`
   - `ExecutionResultData`
   - `TrialRecord`
   - `RunManifestRecord`
   - `RunSummaryData`
2. Internal runtime protocol objects:
   - `RunEvent`
   - `TaskContext`
3. Runtime/domain objects:
   - `Task`
   - `Run`
   - `GraderLayer`
   - `Trial`
   - `RunManifest`
   - `RunSummary`
   - `Suite` (currently mixed with runtime actions)

The main issues are:

1. Some objects are only transport shapes but are modeled as classes.
2. Some domain objects are still too close to transport/data-only wrappers.
3. `Suite` currently mixes definition state with runtime access/actions.
4. Some external-facing runtime contracts still depend on internal domain types.
5. Adapter parsing and domain construction both perform structural validation.

## 3. Target Model

### 3.1 Boundary Contract

Boundary contracts are the only shapes that should be trusted across module or IO
boundaries.

They:

1. may come from external input or persistence
2. require runtime validation when crossing the boundary
3. should stay versioned and stable
4. should not depend on internal domain classes

Scope:

1. DSL documents
2. result/store records
3. public provider/grader input-output data shapes

### 3.2 Internal Protocol

Internal protocols are in-process collaboration messages between core modules.

They:

1. are owned entirely by the core codebase
2. usually need compile-time guarantees only
3. should prefer plain objects or discriminated unions
4. should not gain domain classes unless they later need lifecycle or behavior

Scope:

1. `RunEvent`
2. `TaskContext`
3. similar orchestrator/runtime helper payloads

### 3.3 Domain Object

Domain objects should exist only when they add runtime meaning.

They should have at least one of these properties:

1. invariant enforcement beyond structural schema validation
2. lifecycle transitions
3. derived behavior or aggregation
4. identity/value semantics worth centralizing

Scope:

1. `Task`
2. `Run`
3. `GraderLayer`
4. `Trial`
5. `RunManifest`
6. `RunSummary`

`Suite` should only remain a domain object if it becomes a pure suite definition
value object. It should not also own runtime task execution actions.

## 4. P1 Decision

P1 is to align the object taxonomy and coding style:

1. Keep core domain objects as classes where they carry behavior or invariants.
2. Convert internal protocol-only objects to plain protocol types plus named
   factory helpers when needed.
3. Keep boundary contracts as explicit type/schema modules.

This means the preferred split is:

### Keep As Class

1. `Task`
2. `Run`
3. `GraderLayer`
4. `Trial`
5. `RunManifest`
6. `RunSummary`

### Convert To Plain Protocol + Factory

1. `RunEvent`
2. `TaskContext`

Example direction:

```ts
export type RunEvent =
  | { type: 'run:started'; runId: string; taskId: string; runName: string; totalTrials: number }
  | { type: 'trial:started'; taskId: string; runId: string; runName: string; trialIndex: number }
  | { type: 'trial:completed'; taskId: string; runId: string; runName: string; trialIndex: number; pass: boolean; durationMs: number }
  | { type: 'trial:error'; taskId: string; runId: string; runName: string; trialIndex: number; errorType: 'agent' | 'system'; message: string }
  | { type: 'run:completed'; summary: RunSummaryData };

export const RunEvents = {
  started(...): RunEvent { ... },
  trialStarted(...): RunEvent { ... },
  trialCompleted(...): RunEvent { ... },
  trialError(...): RunEvent { ... },
  completed(...): RunEvent { ... },
};
```

### Keep As Boundary Contract

1. `SuiteDocument`
2. `TaskDocument`
3. `ExecutionResultInput`
4. `ExecutionResultData`
5. `TrialRecord`
6. `RunManifestRecord`
7. `RunSummaryData`

## 5. Phase Plan

Everytime finished a phase, change the status to `finished`.

### Phase 1: Internal Protocol Demotion

Status: finished

Primary goal:

1. Convert internal message/protocol shapes from class-based modeling to plain
   protocol types plus optional factories.

In scope:

1. `RunEvent`
2. `TaskContext`
3. related orchestrator/runtime call sites
4. docs/comments needed to explain the taxonomy decision

Expected changes:

1. Introduce explicit terminology in code/docs:
   - boundary contract
   - internal protocol
   - domain object
2. Replace `RunEvent` class modeling with plain discriminated union objects.
3. Keep `TaskContext` as a plain runtime protocol type only.
4. Add factory helpers only where they improve call-site clarity.

Exit criteria:

1. `RunEvent` no longer needs a domain class layer.
2. Runtime code emits plain protocol objects or protocol factories instead of `new RunEvent(...)`.
3. No unrelated boundary or suite refactor is bundled into this phase.

### Phase 2: Boundary Purity

Status: finished

Primary goal:

1. Make public/boundary contracts independent from internal domain modules.

In scope:

1. `core/contracts/*`
2. public provider/grader/runtime interfaces
3. `ExecutionResult` boundary decision
4. package public surface documentation if the public contract changes

Expected changes:

1. Remove domain dependency from public runtime contracts.
2. `Provider` and `Grader` contracts should depend on boundary/public data types,
   not internal domain classes.
3. `ExecutionResult` should become a core-owned plain runtime type produced by
   boundary parsing, while `ExecutionResultInput` / `ExecutionResultData`
   remain public boundary contracts

Exit criteria:

1. `core/contracts/*` does not import from `core/domain/*`.
2. Public contracts read as standalone public API definitions.
3. `ExecutionResult` has one clear status and one clear usage pattern across
   provider input, internal runtime use, and persisted records.
4. No suite or adapter-ownership refactor is mixed into this phase.

### Phase 3: Domain-Owned Validation

Status: finished

Primary goal:

1. Make domain factories the only legal construction path for runtime suite/task
   objects.

In scope:

1. `Task`
2. `Suite`
3. adapter-to-domain construction path for suite/task loading
4. contract parser placement for suite/task construction

Expected changes:

1. Domain objects become the single trusted construction boundary for suite/task
   runtime objects.
2. Adapters perform IO and raw deserialization only.
3. Domain factories accept `unknown` input plus source metadata where needed.
4. Domain factories call contract parsers internally.
5. Structural parsing is removed from adapters for suite/task runtime construction.

Exit criteria:

1. A suite/task document is structurally parsed once through domain-owned factory
   construction.
2. Adapters no longer own suite/task structural validation.
3. Domain construction is the only legal path to a valid runtime `Task` or
   `Suite`.
4. Responsibility is obvious from signatures and call paths.
5. `Suite` still may carry actions at the end of this phase; that cleanup belongs
   to the next phase.

### Phase 4: Suite Boundary Cleanup

Status: finished

Primary goal:

1. Separate suite definition objects from suite execution handles.

In scope:

1. `Suite`
2. `LoadedSuite`
3. `Core.bindSuite(...)`
4. suite-related public execution handle naming

Recommended end state:

1. `Suite` as pure data/value object
2. `LoadedSuite` as public handle
3. `Core` / task runner orchestration owning execution behavior

Expected changes:

1. Make `Suite` a pure suite definition/value object or remove it as a class if it
   adds no value.
2. Move `listTasks`, `runTask`, and `streamTask` behavior to an application handle.
3. Keep runtime action binding in `LoadedSuite` or rename it to a more explicit
   handle type if needed.
4. Remove the current `Suite.withActions(...)` pattern.

Exit criteria:

1. No domain object mixes definition data with task-source/runtime execution actions.
2. `LoadedSuite` is the only public execution handle.
3. Suite-related responsibilities are easy to explain in one paragraph.

### Phase 5: Baseline Compare Semantics

Status: finished

Primary goal:

1. Align baseline comparison behavior with the task-run-first model.

In scope:

1. `core.baseline.compare(...)`
2. `BaselineComparison`
3. baseline-related helper functions
4. docs covering baseline semantics

Expected changes:

1. Require same `taskId` for baseline comparisons.
2. Fail fast when baseline/current summaries belong to different tasks.
3. Remove task-set style fields such as `regressions` / `improvements` from
   `BaselineComparison`.
4. Keep the comparison result shape focused on single-task metric deltas and
   verdict only.

Exit criteria:

1. Baseline compare semantics match the task-run-first model.
2. The API cannot silently compare unrelated tasks.
3. The result shape reads coherently for a same-task two-run comparison.

### Phase 6: Latency Semantics Clarification

Status: finished

Primary goal:

1. Keep provider-reported latency and core orchestration duration semantically distinct.

In scope:

1. `ExecutionResultData.metrics`
2. `Trial.timings`
3. `RunSummary.avgLatencyMs`
4. docs and naming around latency/duration semantics

Agreed direction:

1. Keep `RunSummary.avgLatencyMs` derived from provider-reported latency.
2. Do not replace it with core `durationMs`.

Exit criteria:

1. No field conflates provider latency with core orchestration duration.
2. Summary metric names map to one stable semantics each.

### Phase 7: Dead and Weak Abstraction Cleanup

Status: finished

Primary goal:

1. Remove wrappers or fields that remain unused after the earlier phases settle.

In scope:

1. `core/runtime/dependency-resolver.ts`
2. unused `Trial.record` / `Trial.trial` convenience getters if they stay unused
3. speculative `gitSha` field until a real producer exists
4. other dead helpers created obvious by the earlier refactors

Exit criteria:

1. Core has fewer no-op wrappers and speculative fields.
2. Each remaining abstraction has a real caller and a clear reason to exist.
3. Every removal has direct reference evidence.
