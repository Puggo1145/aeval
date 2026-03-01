import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

/**
 * Token-budget grader — validates cost constraints from metrics.tokenUsage only.
 *
 * Config:
 *   maxTotal?: number    — maximum total token count
 *   maxInput?: number    — maximum input token count
 *   maxOutput?: number   — maximum output token count
 *
 * At least one budget must be provided.
 */
export async function tokenBudget(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const maxTotal = config.maxTotal;
  const maxInput = config.maxInput;
  const maxOutput = config.maxOutput;

  if (maxTotal === undefined && maxInput === undefined && maxOutput === undefined) {
    return { pass: false, reason: "Config must provide 'maxTotal', 'maxInput', or 'maxOutput'." };
  }

  const usage = result.metrics?.tokenUsage;
  if (!usage) {
    return { pass: false, reason: 'metrics.tokenUsage is not available.' };
  }

  const failures: string[] = [];

  if (maxTotal !== undefined && typeof maxTotal === 'number') {
    const total = usage.total;
    if (total !== undefined && total > maxTotal) {
      failures.push(`Total tokens ${total} exceeds budget ${maxTotal}.`);
    }
  }

  if (maxInput !== undefined && typeof maxInput === 'number') {
    const input = usage.input;
    if (input !== undefined && input > maxInput) {
      failures.push(`Input tokens ${input} exceeds budget ${maxInput}.`);
    }
  }

  if (maxOutput !== undefined && typeof maxOutput === 'number') {
    const output = usage.output;
    if (output !== undefined && output > maxOutput) {
      failures.push(`Output tokens ${output} exceeds budget ${maxOutput}.`);
    }
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' '), meta: { tokenUsage: usage } };
  }

  return { pass: true, reason: 'Token usage within budget.', meta: { tokenUsage: usage } };
}
