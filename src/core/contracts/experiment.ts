import { z } from 'zod';

import { type ExperimentSchemaVersion, SCHEMA_VERSIONS } from './schema-versions.js';

const UnknownRecordSchema = z.object({}).catchall(z.unknown());
const NonEmptyStringSchema = z.string().trim().min(1);

export const ExperimentTaskSourceSelectorSchema = z
  .object({
    revision: NonEmptyStringSchema.optional(),
    tag: NonEmptyStringSchema.optional(),
  })
  .strict();
export type ExperimentTaskSourceSelector = z.infer<typeof ExperimentTaskSourceSelectorSchema>;

export const ExperimentTaskSourceConfigSchema = z
  .object({
    adapter: NonEmptyStringSchema,
    ref: NonEmptyStringSchema,
    selector: ExperimentTaskSourceSelectorSchema.optional(),
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
    options: UnknownRecordSchema.optional(),
  })
  .strict();
export type ExperimentResultStoreConfig = z.infer<typeof ExperimentResultStoreConfigSchema>;

export const ExperimentObserverConfigSchema = z
  .object({
    type: NonEmptyStringSchema,
    options: UnknownRecordSchema.optional(),
  })
  .strict();
export type ExperimentObserverConfig = z.infer<typeof ExperimentObserverConfigSchema>;

export const ExperimentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.EXPERIMENT),
    name: NonEmptyStringSchema,
    taskSource: ExperimentTaskSourceConfigSchema,
    runs: z.array(ExperimentRunConfigSchema).min(1, {
      message: "Field 'experiment.runs' must contain at least one run.",
    }),
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

export type ExperimentDefinition = z.infer<typeof ExperimentSchema> & {
  schemaVersion: ExperimentSchemaVersion;
};
