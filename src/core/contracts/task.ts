import { z } from 'zod';
import { NonEmptyStringSchema, UnknownRecordSchema } from '../utils/zod.js';
import { SCHEMA_VERSIONS } from './schema-versions.js';

export const GRADER_STRATEGIES = ['ALL', 'ANY', 'WEIGHTED'] as const;

const OptionalMetadataStringSchema = z.string().optional();

const TaskTagsSchema = z
  .array(z.unknown())
  .superRefine((tags, ctx) => {
    const hasNonStringTag = tags.some((tag) => typeof tag !== 'string');
    if (hasNonStringTag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Field 'task.tags' must contain only strings.",
      });
    }
  })
  // superRefine 已确保元素都是 string，这里做一次类型收窄供下游使用
  .transform((tags) => tags as string[]);

export const TaskGraderStrategySchema = z.enum(GRADER_STRATEGIES);
export type TaskGraderStrategy = z.infer<typeof TaskGraderStrategySchema>;

export const TaskProviderConfigSchema = z
  .object({
    id: NonEmptyStringSchema,
    params: UnknownRecordSchema.optional(),
  })
  .strict();
export type TaskProviderConfig = z.infer<typeof TaskProviderConfigSchema>;

export const TaskGraderLayerSchema = z
  .object({
    name: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    weight: z.number().finite().gt(0).optional(),
    config: UnknownRecordSchema.optional(),
  })
  .strict();
export type TaskGraderLayer = z.infer<typeof TaskGraderLayerSchema>;

export const TaskGradersConfigSchema = z
  .object({
    strategy: TaskGraderStrategySchema,
    passThreshold: z.unknown().optional(),
    layers: z.array(TaskGraderLayerSchema).min(1, {
      message: "Field 'task.graders.layers' must contain at least one item.",
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.strategy === 'WEIGHTED') {
      if (
        typeof value.passThreshold !== 'number' ||
        !Number.isFinite(value.passThreshold) ||
        value.passThreshold <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Field 'task.graders.passThreshold' is required and must be a finite number > 0 when strategy is WEIGHTED.",
          path: ['passThreshold'],
        });
      }
      return;
    }

    if (value.passThreshold === undefined || value.passThreshold === null) {
      return;
    }

    if (typeof value.passThreshold !== 'number' || !Number.isFinite(value.passThreshold)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Field 'task.graders.passThreshold' must be a finite number when provided.",
        path: ['passThreshold'],
      });
    }
  })
  .transform((value) => {
    const passThreshold: number | null | undefined =
      value.passThreshold === undefined || value.passThreshold === null
        ? value.passThreshold
        : (value.passThreshold as number);

    return {
      strategy: value.strategy,
      passThreshold,
      layers: value.layers,
    };
  });
export type TaskGradersConfig = z.infer<typeof TaskGradersConfigSchema>;

export const TaskExecutionConfigSchema = z
  .object({
    timeoutMs: z.number().int().gt(0),
    // 执行出错时的重试次数
    retryOnError: z.number().int().min(0).optional(),
    // 每个 task 执行的 trial 次数，null 为显式的回退覆盖（回退 experiment 的全局配置）
    trialsPerTask: z.union([z.number().int().gt(0), z.null()]).optional(),
  })
  .strict();
export type TaskExecutionConfig = z.infer<typeof TaskExecutionConfigSchema>;

export const TaskSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.TASK),
    id: NonEmptyStringSchema,
    // -- 描述性字段，不参与执行逻辑 --
    desc: OptionalMetadataStringSchema,
    category: OptionalMetadataStringSchema,
    capability: OptionalMetadataStringSchema,
    tier: OptionalMetadataStringSchema,
    difficulty: OptionalMetadataStringSchema,
    tags: TaskTagsSchema.optional(),
    lifecycle: UnknownRecordSchema.optional(),
    // task 的真实执行逻辑：Agent Harness
    provider: TaskProviderConfigSchema,
    graders: TaskGradersConfigSchema,
    // 自定义的指标，只用于 per task 统计和跟踪，由使用者自行提供和定义
    trackedMetrics: UnknownRecordSchema.optional(),
    execution: TaskExecutionConfigSchema,
  })
  .strict();

export type TaskDefinition = z.infer<typeof TaskSchema>;
