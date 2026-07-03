import { z } from 'zod';
import { throwFirstZodValidationError } from '../validation/helpers.js';
import { NonEmptyStringSchema, UnknownRecordSchema } from './schema-primitives.js';
import { SCHEMA_VERSIONS } from './schema-versions.js';

const documentInputSchema = z.object({}).catchall(z.unknown());

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
  .transform((tags) => tags as string[]);

export const TaskGraderStrategySchema = z.enum(GRADER_STRATEGIES);
export type TaskGraderStrategy = z.infer<typeof TaskGraderStrategySchema>;

export const TaskProviderDocumentSchema = z
  .object({
    id: NonEmptyStringSchema,
    runs: z
      .array(
        z
          .object({
            name: NonEmptyStringSchema,
            params: UnknownRecordSchema,
          })
          .strict(),
      )
      .min(1, {
        message: "Field 'task.provider.runs' must contain at least one run.",
      }),
  })
  .strict()
  .superRefine((provider, ctx) => {
    const seenNames = new Set<string>();

    provider.runs.forEach((run, index) => {
      if (seenNames.has(run.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Run name '${run.name}' must be unique within 'task.provider.runs'.`,
          path: ['runs', index, 'name'],
        });
        return;
      }

      seenNames.add(run.name);
    });
  });
export type TaskProviderDocument = z.infer<typeof TaskProviderDocumentSchema>;
export type TaskProviderRunDocument = TaskProviderDocument['runs'][number];

export const BaseGraderLayerDocumentSchema = z
  .object({
    name: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    config: UnknownRecordSchema.optional(),
  })
  .strict();
export type TaskGraderLayerDocument = z.infer<typeof BaseGraderLayerDocumentSchema>;

export const WeightedGraderLayerDocumentSchema = BaseGraderLayerDocumentSchema.extend({
  weight: z.number().finite().gt(0),
}).strict();
export type WeightedGraderLayerDocument = z.infer<typeof WeightedGraderLayerDocumentSchema>;

const gradersLayersMinOne = {
  message: "Field 'task.graders.layers' must contain at least one item.",
};

export const TaskGradersDocumentSchema = z.discriminatedUnion('strategy', [
  z
    .object({
      strategy: z.literal('ALL'),
      layers: z.array(BaseGraderLayerDocumentSchema).min(1, gradersLayersMinOne),
    })
    .strict(),
  z
    .object({
      strategy: z.literal('ANY'),
      layers: z.array(BaseGraderLayerDocumentSchema).min(1, gradersLayersMinOne),
    })
    .strict(),
  z
    .object({
      strategy: z.literal('WEIGHTED'),
      passThreshold: z.number().finite().gt(0),
      layers: z.array(WeightedGraderLayerDocumentSchema).min(1, gradersLayersMinOne),
    })
    .strict(),
]);
export type TaskGradersDocument = z.infer<typeof TaskGradersDocumentSchema>;

export const TaskExecutionDocumentSchema = z
  .object({
    timeoutMs: z.number().int().gt(0),
    retryOnError: z.number().int().min(0).optional(),
    trialsPerTask: z.number().int().gt(0).optional(),
  })
  .strict();
export type TaskExecutionDocument = z.infer<typeof TaskExecutionDocumentSchema>;

export const TaskDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.TASK),
    id: NonEmptyStringSchema,
    desc: OptionalMetadataStringSchema,
    category: OptionalMetadataStringSchema,
    capability: OptionalMetadataStringSchema,
    tier: OptionalMetadataStringSchema,
    difficulty: OptionalMetadataStringSchema,
    tags: TaskTagsSchema.optional(),
    provider: TaskProviderDocumentSchema,
    graders: TaskGradersDocumentSchema,
    execution: TaskExecutionDocumentSchema,
  })
  .strict();

export type TaskDocument = z.infer<typeof TaskDocumentSchema>;

export function parseTaskDocument(input: unknown): TaskDocument {
  const rawTaskResult = documentInputSchema.safeParse(input);
  if (!rawTaskResult.success) {
    throwFirstZodValidationError(rawTaskResult.error, 'task');
  }

  const taskResult = TaskDocumentSchema.safeParse(rawTaskResult.data);
  if (!taskResult.success) {
    throwFirstZodValidationError(taskResult.error, 'task');
  }

  return taskResult.data;
}
