import { z } from 'zod';
import { type SuiteDefinition, SuiteSchema } from '../contracts/suite.js';
import { throwFirstZodValidationError } from './helpers.js';

const DefinitionInputSchema = z.object({}).catchall(z.unknown());

export function validateSuiteDefinition(input: unknown): SuiteDefinition {
  const rawResult = DefinitionInputSchema.safeParse(input);
  if (!rawResult.success) {
    throwFirstZodValidationError(rawResult.error, 'suite');
  }

  const suiteResult = SuiteSchema.safeParse(rawResult.data);
  if (!suiteResult.success) {
    throwFirstZodValidationError(suiteResult.error, 'suite');
  }

  return suiteResult.data;
}
