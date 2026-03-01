import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

/**
 * Length-check grader — validates output string length.
 *
 * Config:
 *   min?: number   — minimum length (inclusive)
 *   max?: number   — maximum length (inclusive)
 *
 * At least one of min or max must be provided.
 */
export async function lengthCheck(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const min = config.min;
  const max = config.max;

  if (min === undefined && max === undefined) {
    return { pass: false, reason: "Config must provide 'min' or 'max'." };
  }

  if (min !== undefined && (typeof min !== 'number' || !Number.isFinite(min) || min < 0)) {
    return { pass: false, reason: "'min' must be a finite non-negative number." };
  }

  if (max !== undefined && (typeof max !== 'number' || !Number.isFinite(max) || max < 0)) {
    return { pass: false, reason: "'max' must be a finite non-negative number." };
  }

  const length = result.output.length;
  const failures: string[] = [];

  if (min !== undefined && length < (min as number)) {
    failures.push(`Output length ${length} is below minimum ${min}.`);
  }

  if (max !== undefined && length > (max as number)) {
    failures.push(`Output length ${length} exceeds maximum ${max}.`);
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' ') };
  }

  return { pass: true, reason: `Output length ${length} is within bounds.` };
}
