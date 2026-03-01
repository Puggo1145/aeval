import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

interface RegexPattern {
  pattern: string;
  flags?: string;
}

function isRegexPatternArray(value: unknown): value is RegexPattern[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RegexPattern).pattern === 'string',
    )
  );
}

function buildRegex(item: RegexPattern): RegExp {
  return new RegExp(item.pattern, item.flags ?? '');
}

/**
 * Regex grader — validates output against regex patterns.
 *
 * Config:
 *   mustMatch?: Array<{ pattern: string; flags?: string }>
 *   mustNotMatch?: Array<{ pattern: string; flags?: string }>
 *
 * At least one of mustMatch or mustNotMatch must be provided.
 */
export async function regex(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const mustMatch = config.mustMatch;
  const mustNotMatch = config.mustNotMatch;

  if (!mustMatch && !mustNotMatch) {
    return { pass: false, reason: "Config must provide 'mustMatch' or 'mustNotMatch'." };
  }

  if (mustMatch !== undefined && !isRegexPatternArray(mustMatch)) {
    return {
      pass: false,
      reason: "'mustMatch' must be an array of { pattern: string; flags?: string }.",
    };
  }

  if (mustNotMatch !== undefined && !isRegexPatternArray(mustNotMatch)) {
    return {
      pass: false,
      reason: "'mustNotMatch' must be an array of { pattern: string; flags?: string }.",
    };
  }

  const output = result.output;
  const failures: string[] = [];

  if (mustMatch) {
    for (const item of mustMatch) {
      const re = buildRegex(item);
      if (!re.test(output)) {
        failures.push(
          `Output does not match required pattern: /${item.pattern}/${item.flags ?? ''}.`,
        );
      }
    }
  }

  if (mustNotMatch) {
    for (const item of mustNotMatch) {
      const re = buildRegex(item);
      if (re.test(output)) {
        failures.push(`Output matches forbidden pattern: /${item.pattern}/${item.flags ?? ''}.`);
      }
    }
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' ') };
  }

  return { pass: true, reason: 'All regex checks passed.' };
}
