import { z } from 'zod';
import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { Grader } from '../../core/contracts/runtime.js';
import type { GraderResult } from '../../core/contracts/trial.js';
import { type GraderConfigValidationResult, parseGraderConfig } from '../config-validation.js';
import type { JudgeProvider } from './judge-provider.js';

const NonEmptyTrimmedStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, 'Must be a non-empty string.');

const LlmJudgeConfigSchema = z
  .object({
    dimension: NonEmptyTrimmedStringSchema,
    rubric: NonEmptyTrimmedStringSchema,
    assertions: z
      .array(NonEmptyTrimmedStringSchema)
      .min(1, "Config 'assertions' must contain at least one item."),
    passThreshold: z.number().finite().gt(0).lte(1),
    contextFrom: z.string().optional(),
    judge: z
      .object({
        provider: z.literal('aihubmix'),
        model: NonEmptyTrimmedStringSchema,
      })
      .strict(),
  })
  .strict();

type LlmJudgeConfig = z.infer<typeof LlmJudgeConfigSchema>;

interface CreateLlmJudgeGraderOptions {
  validateConfig?: (config: LlmJudgeConfig) => GraderConfigValidationResult;
}

/**
 * Resolves a dot-separated path against the ExecutionResult to extract context.
 * e.g., "outcome.boardContent" → result.outcome?.boardContent
 */
function resolveContextPath(result: ExecutionResult, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = result;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Creates an llm-judge grader bound to a specific JudgeProvider.
 *
 * Config (from Task DSL):
 *   dimension: string         — evaluation dimension
 *   rubric: string            — evaluation rubric text
 *   assertions: string[]      — binary assertions to evaluate
 *   passThreshold: number     — required threshold in (0, 1]
 *   contextFrom?: string      — dot-path into ExecutionResult for context
 *   judge.provider            — aihubmix
 *   judge.model               — concrete judge model id
 */
export function createLlmJudgeGrader(
  judgeProvider: JudgeProvider,
  options: CreateLlmJudgeGraderOptions = {},
): Grader {
  function validateParsedConfig(config: LlmJudgeConfig): GraderConfigValidationResult {
    return options.validateConfig?.(config) ?? { valid: true };
  }

  const grader: Grader = async (
    result: ExecutionResult,
    config: Record<string, unknown>,
  ): Promise<GraderResult> => {
    const parsed = parseGraderConfig(LlmJudgeConfigSchema, config);
    if (!parsed.ok) {
      return {
        pass: false,
        reason: parsed.reason,
      };
    }
    const parsedConfig: LlmJudgeConfig = parsed.config;
    const configValidation = validateParsedConfig(parsedConfig);
    if (!configValidation.valid) {
      return {
        pass: false,
        reason: configValidation.reason ?? 'Invalid grader config.',
      };
    }

    const dimension = parsedConfig.dimension;
    const rubric = parsedConfig.rubric;
    const assertions = parsedConfig.assertions;

    // Resolve optional context from ExecutionResult
    let context: unknown;
    if (parsedConfig.contextFrom !== undefined) {
      context = resolveContextPath(result, parsedConfig.contextFrom);
    }

    const judgeResult = await judgeProvider.evaluate({
      output: result.output,
      rubric,
      assertions,
      context,
      dimension,
      judge: parsedConfig.judge,
    });

    return {
      pass: judgeResult.score >= parsedConfig.passThreshold,
      score: judgeResult.score,
      reason: judgeResult.reason,
      meta: {
        dimension,
        passThreshold: parsedConfig.passThreshold,
        assertions: judgeResult.assertions,
        provider: judgeResult.provider,
        model: judgeResult.model,
      },
    };
  };

  (
    grader as typeof grader & {
      validateConfig: (config: Record<string, unknown>) => GraderConfigValidationResult;
    }
  ).validateConfig = (config: Record<string, unknown>) => {
    const parsed = parseGraderConfig(LlmJudgeConfigSchema, config);
    if (!parsed.ok) {
      return {
        valid: false,
        reason: parsed.reason,
      };
    }

    return validateParsedConfig(parsed.config);
  };

  return grader;
}
