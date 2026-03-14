import type { ExecutionResult, GraderResult } from '@youeval/core';
import { z } from 'zod';
import { ConfiguredGrader } from '../base-grader.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';

const ContainsPatternSchema = z
  .object({
    pattern: z.string(),
    caseSensitive: z.boolean().optional(),
  })
  .strict();

const ContainsConfigSchema = z
  .object({
    mustInclude: z.array(ContainsPatternSchema).min(1).optional(),
    mustNotInclude: z.array(ContainsPatternSchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mustInclude === undefined && value.mustNotInclude === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Config must provide 'mustInclude' or 'mustNotInclude'.",
      });
    }
  });

type ContainsConfig = z.infer<typeof ContainsConfigSchema>;

/**
 * Contains grader — checks that output includes/excludes specified patterns.
 *
 * Config:
 *   mustInclude?: Array<{ pattern: string; caseSensitive?: boolean }>
 *   mustNotInclude?: Array<{ pattern: string; caseSensitive?: boolean }>
 *
 * At least one of mustInclude or mustNotInclude must be provided.
 */
async function gradeContains(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(ContainsConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: ContainsConfig = parsed.config;

  const output = result.output;
  const failures: string[] = [];

  if (parsedConfig.mustInclude) {
    for (const item of parsedConfig.mustInclude) {
      const sensitive = item.caseSensitive !== false;
      const haystack = sensitive ? output : output.toLowerCase();
      const needle = sensitive ? item.pattern : item.pattern.toLowerCase();
      if (!haystack.includes(needle)) {
        failures.push(`Missing required pattern: "${item.pattern}".`);
      }
    }
  }

  if (parsedConfig.mustNotInclude) {
    for (const item of parsedConfig.mustNotInclude) {
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

export const contains = new ConfiguredGrader({
  type: 'contains',
  grade: (result, layer) => gradeContains(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(ContainsConfigSchema, layer.config),
});
