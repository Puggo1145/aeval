import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

interface ContainsPattern {
  pattern: string;
  caseSensitive?: boolean;
}

function isPatternArray(value: unknown): value is ContainsPattern[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ContainsPattern).pattern === 'string',
    )
  );
}

/**
 * Contains grader — checks that output includes/excludes specified patterns.
 *
 * Config:
 *   mustInclude?: Array<{ pattern: string; caseSensitive?: boolean }>
 *   mustNotInclude?: Array<{ pattern: string; caseSensitive?: boolean }>
 *
 * At least one of mustInclude or mustNotInclude must be provided.
 */
export async function contains(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const mustInclude = config.mustInclude;
  const mustNotInclude = config.mustNotInclude;

  if (!mustInclude && !mustNotInclude) {
    return { pass: false, reason: "Config must provide 'mustInclude' or 'mustNotInclude'." };
  }

  if (mustInclude !== undefined && !isPatternArray(mustInclude)) {
    return {
      pass: false,
      reason: "'mustInclude' must be an array of { pattern: string; caseSensitive?: boolean }.",
    };
  }

  if (mustNotInclude !== undefined && !isPatternArray(mustNotInclude)) {
    return {
      pass: false,
      reason: "'mustNotInclude' must be an array of { pattern: string; caseSensitive?: boolean }.",
    };
  }

  const output = result.output;
  const failures: string[] = [];

  if (mustInclude) {
    for (const item of mustInclude) {
      const sensitive = item.caseSensitive !== false;
      const haystack = sensitive ? output : output.toLowerCase();
      const needle = sensitive ? item.pattern : item.pattern.toLowerCase();
      if (!haystack.includes(needle)) {
        failures.push(`Missing required pattern: "${item.pattern}".`);
      }
    }
  }

  if (mustNotInclude) {
    for (const item of mustNotInclude) {
      const sensitive = item.caseSensitive !== false;
      const haystack = sensitive ? output : output.toLowerCase();
      const needle = sensitive ? item.pattern : item.pattern.toLowerCase();
      if (haystack.includes(needle)) {
        failures.push(`Found forbidden pattern: "${item.pattern}".`);
      }
    }
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' ') };
  }

  return { pass: true, reason: 'All contains checks passed.' };
}
