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
 * 运行前校验 Task 对当前 runtime 的依赖是否可解析。
 * 这里只做 runtime 绑定相关的预检，不承担执行策略归一化。
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
 * 将 Task 的声明式 execution 配置与 runtime 默认值合成为最终执行策略。
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
