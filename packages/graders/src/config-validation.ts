import type { z } from 'zod';

export type ParsedGraderConfig<T> =
  | {
      ok: true;
      config: T;
    }
  | {
      ok: false;
      reason: string;
    };

export type GraderConfigValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Parse grader config via zod and normalize to a stable single-line reason.
 */
export function parseGraderConfig<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  config: Record<string, unknown>,
): ParsedGraderConfig<z.infer<TSchema>> {
  const parsed = schema.safeParse(config);
  if (parsed.success) {
    return {
      ok: true,
      config: parsed.data,
    };
  }

  const firstIssue = parsed.error.issues[0];
  const path = formatIssuePath(firstIssue?.path ?? []);
  const location = path ? ` at '${path}'` : '';
  const message = firstIssue?.message ?? 'Invalid grader config.';

  return {
    ok: false,
    reason: `Invalid grader config${location}: ${message}`,
  };
}

export function validateGraderConfig<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  config: Record<string, unknown>,
): GraderConfigValidationResult {
  const parsed = parseGraderConfig(schema, config);
  if (parsed.ok) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: parsed.reason,
  };
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  let formatted = '';

  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${segment}]`;
      continue;
    }

    if (typeof segment === 'string') {
      formatted += formatted.length === 0 ? segment : `.${segment}`;
      continue;
    }

    formatted += formatted.length === 0 ? String(segment) : `.${String(segment)}`;
  }

  return formatted;
}
