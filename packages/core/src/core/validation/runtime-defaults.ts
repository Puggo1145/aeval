import { z } from 'zod';

import type { RuntimeDefaults } from '../contracts/runtime.js';
import { ValidationError } from '../errors/index.js';

export const RuntimeDefaultsSchema = z.object({
  trialConcurrency: z.number().int().gt(0).optional(),
  taskConcurrency: z.number().int().gt(0).optional(),
});

/**
 * Normalized runtime defaults. `trialConcurrency` always resolves to a concrete
 * value; `taskConcurrency` stays optional, where `undefined` means "run all
 * requested tasks at once".
 */
export interface ResolvedRuntimeDefaults {
  trialConcurrency: number;
  taskConcurrency?: number;
}

export function normalizeRuntimeDefaults(
  runtimeDefaults: RuntimeDefaults | undefined,
): ResolvedRuntimeDefaults {
  const result = RuntimeDefaultsSchema.safeParse(runtimeDefaults ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.length
      ? `runtimeDefaults.${issue.path.join('.')}`
      : 'runtimeDefaults';
    throw new ValidationError(issue?.message ?? 'Invalid runtime defaults.', {
      details: {
        field,
        value: runtimeDefaults,
      },
    });
  }

  return {
    trialConcurrency: result.data.trialConcurrency ?? 5,
    ...(result.data.taskConcurrency !== undefined
      ? { taskConcurrency: result.data.taskConcurrency }
      : {}),
  };
}
