import type { Graders, Providers, RuntimeDefaults } from '../contracts/runtime.js';
import type { Task } from '../domain/task.js';
import { ValidationError } from '../errors/index.js';

export interface ExecutionPolicy {
  readonly timeoutMs: number;
  readonly retryOnError: number;
  readonly trialsPerTask: number;
  readonly maxConcurrency: number;
}

export interface TaskRuntimeValidationDeps {
  providers: Providers;
  graders: Graders;
}

/**
 * Pre-run check that the task's provider and graders resolve against the
 * current runtime. Execution policy normalization is handled separately.
 */
export function validateTaskRuntime(task: Task, deps: TaskRuntimeValidationDeps): void {
  deps.providers.require(task.providerId);

  for (const [layerIndex, layer] of task.graderLayers.entries()) {
    const grader = deps.graders.require(layer.type);
    const validation = grader.validate?.(layer);
    if (validation && !validation.valid) {
      throw new ValidationError(
        `Invalid config for grader '${layer.type}' on task '${task.id}' at layer ${layerIndex}.`,
        {
          details: {
            field: `task.graders.layers[${layerIndex}].config`,
            reason: validation.reason ?? 'Unknown config error.',
          },
        },
      );
    }
  }
}

/**
 * Merge the task's declared execution config with runtime defaults into the
 * effective execution policy.
 */
export function resolveExecutionPolicy(
  task: Task,
  runtimeDefaults: Required<RuntimeDefaults>,
): ExecutionPolicy {
  return Object.freeze({
    timeoutMs: task.execution.timeoutMs,
    retryOnError: task.execution.retryOnError ?? 0,
    trialsPerTask: task.execution.trialsPerTask ?? 1,
    maxConcurrency: task.execution.maxConcurrency ?? runtimeDefaults.maxConcurrency,
  });
}
