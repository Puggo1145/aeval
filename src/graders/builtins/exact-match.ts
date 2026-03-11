import { z } from 'zod';
import type { ExecutionResult, GraderResult } from '../../index.js';
import { ConfiguredGrader } from '../base-grader.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';

const ExactMatchConfigSchema = z
  .object({
    expected: z.string(),
    caseSensitive: z.boolean().optional(),
    trim: z.boolean().optional(),
  })
  .strict();

type ExactMatchConfig = z.infer<typeof ExactMatchConfigSchema>;

/**
 * Exact-match grader — compares `output` against an expected string.
 *
 * Config:
 *   expected: string          — the expected output value
 *   caseSensitive?: boolean   — default true
 *   trim?: boolean            — trim whitespace before comparison, default false
 */
async function gradeExactMatch(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(ExactMatchConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: ExactMatchConfig = parsed.config;

  const caseSensitive = parsedConfig.caseSensitive !== false;
  const trim = parsedConfig.trim === true;

  let actual = result.output;
  let exp = parsedConfig.expected;

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
      : `Output does not match. Expected: "${parsedConfig.expected}", got: "${result.output}".`,
  };
}

export const exactMatch = new ConfiguredGrader({
  type: 'exact-match',
  grade: (result, layer) => gradeExactMatch(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(ExactMatchConfigSchema, layer.config),
});
