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

  const experiment = experimentResult.data;
  return {
    schemaVersion: experiment.schemaVersion,
    name: experiment.name,
    taskSource: {
      adapter: experiment.taskSource.adapter,
    },
    runs: experiment.runs,
    trialsPerTask: experiment.trialsPerTask,
    maxConcurrency: experiment.maxConcurrency,
    timeoutMs: experiment.timeoutMs,
    resultStore: {
      adapter: experiment.resultStore.adapter,
    },
    observers: experiment.observers,
  };
}
