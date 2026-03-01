import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

/**
 * Exact-match grader — compares `output` against an expected string.
 *
 * Config:
 *   expected: string          — the expected output value
 *   caseSensitive?: boolean   — default true
 *   trim?: boolean            — trim whitespace before comparison, default false
 */
export async function exactMatch(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const expected = config.expected;
  if (typeof expected !== 'string') {
    return { pass: false, reason: "Config 'expected' must be a string." };
  }

  const caseSensitive = config.caseSensitive !== false;
  const trim = config.trim === true;

  let actual = result.output;
  let exp = expected;

  if (trim) {
    actual = actual.trim();
    exp = exp.trim();
  }

  if (!caseSensitive) {
    actual = actual.toLowerCase();
    exp = exp.toLowerCase();
  }

  const pass = actual === exp;
  return {
    pass,
    reason: pass
      ? 'Output exactly matches expected value.'
      : `Output does not match. Expected: "${expected}", got: "${result.output}".`,
  };
}
