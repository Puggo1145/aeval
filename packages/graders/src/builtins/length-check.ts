import type { ExecutionResult, GraderResult } from '@aeval/core';
import { z } from 'zod';
import { ConfiguredGrader } from '../base-grader.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';

const LengthCheckConfigSchema = z
  .object({
    min: z.number().finite().nonnegative().optional(),
    max: z.number().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.min === undefined && value.max === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Config must provide 'min' or 'max'.",
      });
    }

    if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['min'],
        message: "Field 'min' must be less than or equal to 'max'.",
      });
    }
  });

type LengthCheckConfig = z.infer<typeof LengthCheckConfigSchema>;

/**
 * Length-check grader — validates output string length.
 *
 * Config:
 *   min?: number   — minimum length (inclusive)
 *   max?: number   — maximum length (inclusive)
 *
 * At least one of min or max must be provided.
 */
async function gradeLengthCheck(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(LengthCheckConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: LengthCheckConfig = parsed.config;

  const length = result.output.length;
  const failures: string[] = [];

  if (parsedConfig.min !== undefined && length < parsedConfig.min) {
    failures.push(`Output length ${length} is below minimum ${parsedConfig.min}.`);
  }

  if (parsedConfig.max !== undefined && length > parsedConfig.max) {
    failures.push(`Output length ${length} exceeds maximum ${parsedConfig.max}.`);
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' ') };
  }

  return { pass: true, reason: `Output length ${length} is within bounds.` };
}

export const lengthCheck = new ConfiguredGrader({
  type: 'length-check',
  grade: (result, layer) => gradeLengthCheck(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(LengthCheckConfigSchema, layer.config),
});
