import type { ExecutionResult, GraderResult } from '@aeval/core';
import { z } from 'zod';
import { ConfiguredGrader } from '../base-grader.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';

const TokenBudgetConfigSchema = z
  .object({
    maxTotal: z.number().int().finite().nonnegative().optional(),
    maxInput: z.number().int().finite().nonnegative().optional(),
    maxOutput: z.number().int().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.maxTotal === undefined &&
      value.maxInput === undefined &&
      value.maxOutput === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Config must provide 'maxTotal', 'maxInput', or 'maxOutput'.",
      });
    }
  });

type TokenBudgetConfig = z.infer<typeof TokenBudgetConfigSchema>;

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
async function gradeTokenBudget(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(TokenBudgetConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: TokenBudgetConfig = parsed.config;

  const usage = result.metrics?.tokenUsage;
  if (!usage) {
    return { pass: false, reason: 'metrics.tokenUsage is not available.' };
  }

  const failures: string[] = [];

  if (parsedConfig.maxTotal !== undefined) {
    const total = usage.total;
    if (typeof total !== 'number') {
      failures.push("metrics.tokenUsage.total is required when 'maxTotal' is configured.");
    } else if (total > parsedConfig.maxTotal) {
      failures.push(`Total tokens ${total} exceeds budget ${parsedConfig.maxTotal}.`);
    }
  }

  if (parsedConfig.maxInput !== undefined) {
    const input = usage.input;
    if (typeof input !== 'number') {
      failures.push("metrics.tokenUsage.input is required when 'maxInput' is configured.");
    } else if (input > parsedConfig.maxInput) {
      failures.push(`Input tokens ${input} exceeds budget ${parsedConfig.maxInput}.`);
    }
  }

  if (parsedConfig.maxOutput !== undefined) {
    const output = usage.output;
    if (typeof output !== 'number') {
      failures.push("metrics.tokenUsage.output is required when 'maxOutput' is configured.");
    } else if (output > parsedConfig.maxOutput) {
      failures.push(`Output tokens ${output} exceeds budget ${parsedConfig.maxOutput}.`);
    }
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' '), meta: { tokenUsage: usage } };
  }

  return { pass: true, reason: 'Token usage within budget.', meta: { tokenUsage: usage } };
}

export const tokenBudget = new ConfiguredGrader({
  type: 'token-budget',
  grade: (result, layer) => gradeTokenBudget(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(TokenBudgetConfigSchema, layer.config),
});
