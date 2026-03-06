import { z } from 'zod';
import { NonEmptyStringSchema } from './schema-primitives.js';
import { SCHEMA_VERSIONS } from './schema-versions.js';

export const SuiteSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.SUITE),
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    discover: z.array(NonEmptyStringSchema).min(1, {
      message: "Field 'suite.discover' must contain at least one pattern.",
    }),
  })
  .strict();

export type SuiteDefinition = z.infer<typeof SuiteSchema>;
