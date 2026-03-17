import type { ExecutionResult, GraderResult } from '@youmindinc/youeval-core';
import { z } from 'zod';
import { ConfiguredGrader } from '../base-grader.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';

const RegexPatternSchema = z
  .object({
    pattern: z.string(),
    flags: z.string().optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    try {
      new RegExp(item.pattern, item.flags ?? '');
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid regex /${item.pattern}/${item.flags ?? ''}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  });

const RegexConfigSchema = z
  .object({
    mustMatch: z.array(RegexPatternSchema).min(1).optional(),
    mustNotMatch: z.array(RegexPatternSchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mustMatch === undefined && value.mustNotMatch === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Config must provide 'mustMatch' or 'mustNotMatch'.",
      });
    }
  });

type RegexConfig = z.infer<typeof RegexConfigSchema>;

/**
 * Regex grader — validates output against regex patterns.
 *
 * Config:
 *   mustMatch?: Array<{ pattern: string; flags?: string }>
 *   mustNotMatch?: Array<{ pattern: string; flags?: string }>
 *
 * At least one of mustMatch or mustNotMatch must be provided.
 */
async function gradeRegex(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(RegexConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: RegexConfig = parsed.config;

  const output = result.output;
  const failures: string[] = [];

  if (parsedConfig.mustMatch) {
    for (const item of parsedConfig.mustMatch) {
      const re = new RegExp(item.pattern, item.flags ?? '');
      if (!re.test(output)) {
        failures.push(
          `Output does not match required pattern: /${item.pattern}/${item.flags ?? ''}.`,
        );
      }
    }
  }

  if (parsedConfig.mustNotMatch) {
    for (const item of parsedConfig.mustNotMatch) {
      const re = new RegExp(item.pattern, item.flags ?? '');
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

export const regex = new ConfiguredGrader({
  type: 'regex',
  grade: (result, layer) => gradeRegex(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(RegexConfigSchema, layer.config),
});
