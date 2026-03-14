import { z } from 'zod';

import type { RuntimeDefaults } from '../contracts/runtime.js';
import { ValidationError } from '../errors/index.js';

export const RuntimeDefaultsSchema = z.object({
  maxConcurrency: z.number().int().gt(0).optional(),
});

export function normalizeRuntimeDefaults(
  runtimeDefaults: RuntimeDefaults | undefined,
): Required<RuntimeDefaults> {
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
    maxConcurrency: result.data.maxConcurrency ?? 5,
  };
}
