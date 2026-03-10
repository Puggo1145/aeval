# Task-Run-First V1 Implementation Plan

Status: completed in the current codebase.

## 1. Contract Surface

- [x] Add `suite.v1` schema and validator.
- [x] Redefine `task.v1` provider shape to `id + runs[]`.
- [x] Add `task.execution.maxConcurrency`.

## 2. Tasks and Loading

- [x] Redefine `Tasks` as `listSuites/resolveSuite/resolveTask`.
- [x] Make `LocalTask` scan `rootDir` for suite YAML files.
- [x] Resolve `suite.discover[]` relative to `rootDir`.
- [x] Return `TaskIndex[]` from `resolveSuite`.
- [x] Return `Task` with source metadata; compute canonical `taskHash` in Core.

## 3. Runtime and Orchestration

- [x] Replace dataset-level run orchestration with task-run orchestration.
- [x] Execute all `provider.runs[]` for a selected task.
- [x] Keep runs serial and allow trial concurrency within a run.
- [x] Redefine `configHash` to task-run scope.
- [x] Redefine `RunManifest` and `RunSummary` fields to suite/task/run semantics.
- [x] Update `RunEvent` so UIs can render `taskId + runName + trialIndex`.

## 4. Core API and TUI

- [x] Expose `listSuites/loadSuite/loadSuites` from Core.
- [x] Expose `Suite.runTask/streamTask` for task execution.
- [x] Update TUI flow to `suite -> task -> execute all runs`.
- [x] Update results views to group by suite, task, and run.

## 5. Examples and Docs

- [x] Migrate examples to `suite.v1` and `task.v1` YAML documents with task-level `provider.runs[]`.
- [x] Move provider model variants into `task.provider.runs[]`.
- [x] Keep providers parameterized only by the selected run params.
- [x] Update `README.md`, `DESIGN.md`, and contract docs to the new model.

## 6. Verification

- [x] Rewrite DSL validation tests for suite/task contracts.
- [x] Rewrite task source adapter tests for suite discovery and task resolution.
- [x] Rewrite core/orchestrator tests for task-run execution semantics.
- [x] Rewrite TUI and result-store tests for suite/task/run grouping.
- [x] Keep `pnpm typecheck` and `pnpm test` green after migration.
