import type { GraderRegistry, ProviderRegistry } from '../contracts/runtime.js';
import type { TaskDefinition } from '../contracts/task.js';
import { cloneAndDeepFreezeRecord } from '../orchestrator/immutable-input.js';
import { resolveGraderOrThrow, resolveProviderOrThrow } from './dependency-resolver.js';

interface GraderConfigValidationResult {
  valid: boolean;
  reason?: string;
}

interface GraderWithConfigValidator {
  validateConfig?: (config: Record<string, unknown>) => GraderConfigValidationResult;
}

export function assertTaskExecutionReady(
  task: TaskDefinition,
  deps: Pick<
    { providerRegistry: ProviderRegistry; graderRegistry: GraderRegistry },
    'providerRegistry' | 'graderRegistry'
  >,
): void {
  resolveProviderOrThrow(task.provider.id, deps.providerRegistry);

  for (const [layerIndex, layer] of task.graders.layers.entries()) {
    const grader = resolveGraderOrThrow(layer.type, deps.graderRegistry);
    const configValidator = (grader as typeof grader & GraderWithConfigValidator).validateConfig;
    const validation = configValidator?.(cloneAndDeepFreezeRecord(layer.config));
    if (validation && !validation.valid) {
      throw new Error(
        `Invalid config for grader '${layer.type}' on task '${task.id}' at layer ${layerIndex}: ${validation.reason ?? 'Unknown config error.'}`,
      );
    }
  }
}
