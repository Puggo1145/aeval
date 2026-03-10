export type { Observer } from './core/adapters/observer-adapter.js';
export type {
  BaselineRecord,
  ClearedResultEntry,
  Stores,
} from './core/adapters/result-store-adapter.js';
export type {
  ResolvedSuite,
  ResolvedTask,
  SuiteDescriptor,
  SuiteSource,
  TaskIndex,
  TaskRef,
  TaskSource,
  Tasks,
} from './core/adapters/task-source-adapter.js';
export {
  type CompareBaselineOptions,
  Core,
  type CoreApi,
  type CoreDependencies,
  LoadedSuite,
  type LoadedSuiteInit,
  type LoadSuiteInput,
} from './core/api/index.js';
export * from './core/contracts/index.js';
export { ExecutionResult, type ExecutionResultInit } from './core/domain/execution-result.js';
export { Graders } from './core/runtime/grader-registry.js';
export { Providers } from './core/runtime/provider-registry.js';
