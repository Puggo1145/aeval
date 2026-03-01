import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

/**
 * Outcome-check grader — validates real environment results from outcome.
 *
 * Config:
 *   expect: Record<string, unknown>  — key-value pairs to check against outcome
 *
 * Each key in `expect` is checked against the corresponding key in `result.outcome`.
 * Values are compared using deep equality.
 */
export async function outcomeCheck(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const expect = config.expect;
  if (typeof expect !== 'object' || expect === null || Array.isArray(expect)) {
    return { pass: false, reason: "Config 'expect' must be a non-null object." };
  }

  const outcome = result.outcome;
  if (!outcome) {
    return { pass: false, reason: 'ExecutionResult has no outcome.' };
  }

  const failures: string[] = [];
  const expectations = expect as Record<string, unknown>;

  for (const [key, expectedValue] of Object.entries(expectations)) {
    const actualValue = outcome[key];
    if (!deepEqual(actualValue, expectedValue)) {
      failures.push(
        `outcome.${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}.`,
      );
    }
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' ') };
  }

  return { pass: true, reason: 'All outcome checks passed.' };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
