import { z } from 'zod';
import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { Grader } from '../../core/contracts/runtime.js';
import type { GraderResult } from '../../core/contracts/trial.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';
import type { JudgeProvider } from './judge-provider.js';

const LlmJudgeConfigSchema = z
  .object({
    dimension: z
      .string()
      .refine((value) => value.trim().length > 0, "Config 'dimension' must be a non-empty string."),
    rubric: z
      .string()
      .refine((value) => value.trim().length > 0, "Config 'rubric' must be a non-empty string."),
    contextFrom: z.string().optional(),
    model: z.string().optional(),
  })
  .strict();

type LlmJudgeConfig = z.infer<typeof LlmJudgeConfigSchema>;

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
 *   dimension: string         — evaluation dimension (e.g., "faithfulness")
 *   rubric: string            — evaluation rubric text
 *   contextFrom?: string      — dot-path into ExecutionResult for context (e.g., "outcome.boardContent")
 *   model?: string            — hint for which judge model to use (passed through to provider)
 */
export function createLlmJudgeGrader(judgeProvider: JudgeProvider): Grader {
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

    const dimension = parsedConfig.dimension;
    const rubric = parsedConfig.rubric;

    // Resolve optional context from ExecutionResult
    let context: unknown;
    if (parsedConfig.contextFrom !== undefined) {
      context = resolveContextPath(result, parsedConfig.contextFrom);
    }

    const judgeResult = await judgeProvider.evaluate({
      output: result.output,
      rubric,
      context,
      dimension,
    });

    return {
      pass: judgeResult.pass,
      score: judgeResult.score,
      reason: judgeResult.reason,
      meta: {
        label: judgeResult.label,
        dimension,
        model: parsedConfig.model,
      },
    };
  };

  (
    grader as typeof grader & {
      validateConfig: (config: Record<string, unknown>) => GraderConfigValidationResult;
    }
  ).validateConfig = (config: Record<string, unknown>) =>
    validateGraderConfig(LlmJudgeConfigSchema, config);

  return grader;
}
