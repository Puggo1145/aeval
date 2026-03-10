import { z } from 'zod';
import type { ExecutionResult, ExecutionResultData, GraderResult } from '../../index.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';
import { ConfiguredGrader } from '../base-grader.js';

const OutcomeCheckConfigSchema = z
  .object({
    expect: z.record(z.string(), z.unknown()),
  })
  .strict();

type OutcomeCheckConfig = z.infer<typeof OutcomeCheckConfigSchema>;

/**
 * Outcome-check grader — validates real environment results from outcome.
 *
 * Config:
 *   expect: Record<string, unknown>  — key-value pairs to check against outcome
 *
 * Each key in `expect` is checked against the corresponding key in `result.outcome`.
 * Values are compared using deep equality.
 */
async function gradeOutcomeCheck(
  result: ExecutionResult | ExecutionResultData,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(OutcomeCheckConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: OutcomeCheckConfig = parsed.config;

  const outcome = result.outcome;
  if (!outcome) {
    return { pass: false, reason: 'ExecutionResult has no outcome.' };
  }

  const failures: string[] = [];
  const expectations = parsedConfig.expect;

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

export const outcomeCheck = new ConfiguredGrader({
  type: 'outcome-check',
  grade: (result, layer) => gradeOutcomeCheck(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(OutcomeCheckConfigSchema, layer.config),
});
