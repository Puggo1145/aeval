import { z } from 'zod';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import { type TaskDefinition, TaskSchema } from '../contracts/task.js';
import { throwFirstZodValidationError } from './helpers.js';

const DefinitionInputSchema = z.object({}).catchall(z.unknown());

export function validateTaskDefinition(input: unknown): TaskDefinition {
  // 先瞅瞅是不是对象，不然没法 parse
  const rawTaskResult = DefinitionInputSchema.safeParse(input);
  if (!rawTaskResult.success) {
    throwFirstZodValidationError(rawTaskResult.error, 'task');
  }

  const taskResult = TaskSchema.safeParse(rawTaskResult.data);
  if (!taskResult.success) {
    throwFirstZodValidationError(taskResult.error, 'task');
  }

  const task = taskResult.data;
  const validatedTask: TaskDefinition = {
    schemaVersion: SCHEMA_VERSIONS.TASK,
    id: task.id,
    provider: {
      id: task.provider.id,
      runs: task.provider.runs.map((run) => ({
        name: run.name,
        params: run.params,
      })),
    },
    graders: task.graders,
    trackedMetrics: task.trackedMetrics,
    execution: {
      timeoutMs: task.execution.timeoutMs,
      retryOnError: task.execution.retryOnError,
      trialsPerTask: task.execution.trialsPerTask,
      maxConcurrency: task.execution.maxConcurrency,
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
