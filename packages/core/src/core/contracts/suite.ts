import { z } from 'zod';
import { throwFirstZodValidationError } from '../validation/helpers.js';
import { NonEmptyStringSchema } from './schema-primitives.js';
import { SCHEMA_VERSIONS } from './schema-versions.js';

const documentInputSchema = z.object({}).catchall(z.unknown());

export const SuiteDocumentSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSIONS.SUITE),
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    discover: z.array(NonEmptyStringSchema),
  })
  .strict();

export type SuiteDocument = z.infer<typeof SuiteDocumentSchema>;

export function parseSuiteDocument(input: unknown): SuiteDocument {
  // Reject non-object input first so field-level errors read consistently.
  const rawResult = documentInputSchema.safeParse(input);
  if (!rawResult.success) {
    throwFirstZodValidationError(rawResult.error, 'suite');
  }

  const suiteResult = SuiteDocumentSchema.safeParse(rawResult.data);
  if (!suiteResult.success) {
    throwFirstZodValidationError(suiteResult.error, 'suite');
  }

  return suiteResult.data;
}
