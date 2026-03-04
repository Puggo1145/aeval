import { z } from 'zod';
import { NonEmptyStringSchema, UnknownRecordSchema } from './schema-primitives.js';
import { SCHEMA_VERSIONS } from './schema-versions.js';

/**
 * 实验的 task source 配置
 *
 * adapter 全权负责数据发现，所有 adapter 特定配置统一放在 options 中。
 */
export const ExperimentTaskSourceConfigSchema = z
  .object({
    adapter: NonEmptyStringSchema,
  })
  .strict();
export type ExperimentTaskSourceConfig = z.infer<typeof ExperimentTaskSourceConfigSchema>;

export const ExperimentRunConfigSchema = z
  .object({
    name: NonEmptyStringSchema,
    overrides: UnknownRecordSchema.optional(),
  })
  .strict();
export type ExperimentRunConfig = z.infer<typeof ExperimentRunConfigSchema>;

export const ExperimentResultStoreConfigSchema = z
  .object({
    adapter: NonEmptyStringSchema,
  })
  .strict();
export type ExperimentResultStoreConfig = z.infer<typeof ExperimentResultStoreConfigSchema>;

export const ExperimentObserverConfigSchema = z
  .object({
    type: NonEmptyStringSchema,
  })
  .strict();
export type ExperimentObserverConfig = z.infer<typeof ExperimentObserverConfigSchema>;

export const ExperimentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.EXPERIMENT),
    name: NonEmptyStringSchema,
    taskSource: ExperimentTaskSourceConfigSchema,
    // 一次实验所有要执行的 task runs 的配置
    runs: z.array(ExperimentRunConfigSchema).min(1, {
      message: "Field 'experiment.runs' must contain at least one run.",
    }),
    // 全局默认配置，对所有 task 生效：每个 task 实验几次（可以被 task 覆盖）
    trialsPerTask: z.number().int().gt(0).optional(),
    maxConcurrency: z.number().int().gt(0),
    timeoutMs: z.number().int().gt(0).optional(),
    resultStore: ExperimentResultStoreConfigSchema,
    observers: z.array(ExperimentObserverConfigSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenNames = new Set<string>();

    value.runs.forEach((run, index) => {
      if (seenNames.has(run.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Run name '${run.name}' must be unique within 'experiment.runs'.`,
          path: ['runs', index, 'name'],
        });
        return;
      }
      seenNames.add(run.name);
    });
  });

export type ExperimentDefinition = z.infer<typeof ExperimentSchema>;
