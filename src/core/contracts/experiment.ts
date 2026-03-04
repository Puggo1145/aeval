import { z } from 'zod';
import { NonEmptyStringSchema, UnknownRecordSchema } from './schema-primitives.js';

export const ExperimentRunConfigSchema = z
  .object({
    name: NonEmptyStringSchema,
    overrides: UnknownRecordSchema.optional(),
  })
  .strict();
export type ExperimentRunConfig = z.infer<typeof ExperimentRunConfigSchema>;

export const ExperimentSchema = z
  .object({
    name: NonEmptyStringSchema,
    runs: z.array(ExperimentRunConfigSchema).min(1, {
      message: "Field 'experiment.runs' must contain at least one run.",
    }),
    trialsPerTask: z.number().int().gt(0).optional(),
    maxConcurrency: z.number().int().gt(0),
    timeoutMs: z.number().int().gt(0).optional(),
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
