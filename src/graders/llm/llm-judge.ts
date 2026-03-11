import { z } from 'zod';
import type {
  ExecutionResult,
  Grader,
  GraderLayer,
  GraderResult,
  GraderValidationResult,
} from '../../index.js';
import { parseGraderConfig } from '../config-validation.js';
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

export interface LlmJudgeGraderOptions {
  validateConfig?: (config: LlmJudgeConfig) => GraderValidationResult;
}

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

export class LlmJudgeGrader implements Grader {
  readonly type = 'llm-judge';

  constructor(
    private readonly judgeProvider: JudgeProvider,
    private readonly options: LlmJudgeGraderOptions = {},
  ) {}

  async grade(result: ExecutionResult, layer: GraderLayer): Promise<GraderResult> {
    const parsed = parseGraderConfig(LlmJudgeConfigSchema, layer.config);
    if (!parsed.ok) {
      return {
        pass: false,
        reason: parsed.reason,
      };
    }

    const parsedConfig = parsed.config;
    const configValidation = this.validateParsedConfig(parsedConfig);
    if (!configValidation.valid) {
      return {
        pass: false,
        reason: configValidation.reason ?? 'Invalid grader config.',
      };
    }

    let context: unknown;
    if (parsedConfig.contextFrom !== undefined) {
      context = resolveContextPath(result, parsedConfig.contextFrom);
    }

    const judgeResult = await this.judgeProvider.evaluate({
      output: result.output,
      rubric: parsedConfig.rubric,
      assertions: parsedConfig.assertions,
      context,
      dimension: parsedConfig.dimension,
      judge: parsedConfig.judge,
    });

    return {
      pass: judgeResult.score >= parsedConfig.passThreshold,
      score: judgeResult.score,
      reason: judgeResult.reason,
      meta: {
        dimension: parsedConfig.dimension,
        passThreshold: parsedConfig.passThreshold,
        assertions: judgeResult.assertions,
        provider: judgeResult.provider,
        model: judgeResult.model,
      },
    };
  }

  validate(layer: GraderLayer): GraderValidationResult {
    const parsed = parseGraderConfig(LlmJudgeConfigSchema, layer.config);
    if (!parsed.ok) {
      return {
        valid: false,
        reason: parsed.reason,
      };
    }

    return this.validateParsedConfig(parsed.config);
  }

  private validateParsedConfig(config: LlmJudgeConfig): GraderValidationResult {
    return this.options.validateConfig?.(config) ?? { valid: true };
  }
}
