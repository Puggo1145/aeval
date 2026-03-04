import { z } from 'zod';

import { type ExperimentDefinition, ExperimentSchema } from '../contracts/experiment.js';
import { throwFirstZodValidationError } from './helpers.js';

const DefinitionInputSchema = z.object({}).catchall(z.unknown());

export function validateExperimentDefinition(input: unknown): ExperimentDefinition {
  const rawExperimentResult = DefinitionInputSchema.safeParse(input);
  if (!rawExperimentResult.success) {
    throwFirstZodValidationError(rawExperimentResult.error, 'experiment');
  }

  const experimentResult = ExperimentSchema.safeParse(rawExperimentResult.data);
  if (!experimentResult.success) {
    throwFirstZodValidationError(experimentResult.error, 'experiment');
  }

  return experimentResult.data;
}
