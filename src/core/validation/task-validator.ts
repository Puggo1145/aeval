import { z } from 'zod';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import { type TaskDefinition, TaskSchema } from '../contracts/task.js';
import { throwFirstZodValidationError, throwValidationError } from './helpers.js';

export interface TaskValidationOptions {
  isProviderRegistered: (providerId: string) => boolean;
  listProviderIds?: () => string[];
}

const DefinitionInputSchema = z.object({}).catchall(z.unknown());

export function validateTaskDefinition(
  input: unknown,
  options: TaskValidationOptions,
): TaskDefinition {
  const rawTaskResult = DefinitionInputSchema.safeParse(input);
  if (!rawTaskResult.success) {
    throwFirstZodValidationError(rawTaskResult.error, 'task');
  }

  const taskResult = TaskSchema.safeParse(rawTaskResult.data);
  if (!taskResult.success) {
    throwFirstZodValidationError(taskResult.error, 'task');
  }

  const task = taskResult.data;
  if (!options.isProviderRegistered(task.provider.id)) {
    throwValidationError(
      `Field 'task.provider.id' references unknown provider '${task.provider.id}'.`,
      'task.provider.id',
      {
        providerId: task.provider.id,
        knownProviders: options.listProviderIds?.() ?? [],
      },
    );
  }

  const validatedTask: TaskDefinition = {
    schemaVersion: SCHEMA_VERSIONS.TASK,
    id: task.id,
    provider: {
      id: task.provider.id,
      params: task.provider.params,
    },
    graders: task.graders,
    trackedMetrics: task.trackedMetrics,
    execution: {
      timeoutMs: task.execution.timeoutMs,
      retryOnError: task.execution.retryOnError,
      trialsPerTask: task.execution.trialsPerTask,
    },
  };

  if (task.desc !== undefined) {
    validatedTask.desc = task.desc;
  }
  if (task.category !== undefined) {
    validatedTask.category = task.category;
  }
  if (task.capability !== undefined) {
    validatedTask.capability = task.capability;
  }
  if (task.tier !== undefined) {
    validatedTask.tier = task.tier;
  }
  if (task.difficulty !== undefined) {
    validatedTask.difficulty = task.difficulty;
  }
  if (task.tags !== undefined) {
    validatedTask.tags = task.tags;
  }
  if (task.lifecycle !== undefined) {
    validatedTask.lifecycle = task.lifecycle;
  }

  return validatedTask;
}

export interface TaskDatasetValidationOptions extends TaskValidationOptions {
  datasetRevision?: string;
}

export function validateTaskDefinitions(
  inputs: unknown[],
  options: TaskDatasetValidationOptions,
): TaskDefinition[] {
  const validatedTasks = inputs.map((input) => validateTaskDefinition(input, options));
  const firstSeenByTaskId = new Map<string, number>();

  for (const [index, task] of validatedTasks.entries()) {
    const firstSeenIndex = firstSeenByTaskId.get(task.id);
    if (firstSeenIndex !== undefined) {
      throwValidationError(
        `Field 'task.id' must be unique inside one dataset revision, duplicate id '${task.id}' found.`,
        `tasks[${index}].id`,
        {
          taskId: task.id,
          firstSeenIndex,
          duplicateIndex: index,
          datasetRevision: options.datasetRevision,
        },
      );
    }
    firstSeenByTaskId.set(task.id, index);
  }

  return validatedTasks;
}
