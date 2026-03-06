import type { RuntimeDefaults } from '../contracts/runtime.js';
import type { TaskDefinition } from '../contracts/task.js';

export interface EffectiveExecutionConfig {
  timeoutMs: number;
  retryOnError: number;
  trialsPerTask: number;
  maxConcurrency: number;
}

export function getEffectiveExecution(
  task: TaskDefinition,
  runtimeDefaults: Required<RuntimeDefaults>,
): EffectiveExecutionConfig {
  return {
    timeoutMs: task.execution.timeoutMs,
    retryOnError: task.execution.retryOnError ?? 0,
    trialsPerTask: task.execution.trialsPerTask ?? 1,
    maxConcurrency: task.execution.maxConcurrency ?? runtimeDefaults.maxConcurrency,
  };
}
