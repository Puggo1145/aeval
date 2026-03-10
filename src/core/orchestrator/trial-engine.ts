import { SYSTEM_ERROR_CODES, type SystemErrorCode } from '../contracts/execution.js';
import type { Graders, Providers, TaskContext } from '../contracts/runtime.js';
import { ExecutionResult } from '../domain/execution-result.js';
import type { Run } from '../domain/run.js';
import type { Task } from '../domain/task.js';
import { Trial } from '../domain/trial.js';
import {
  createTrialTimeoutAbortReason,
  isStreamClosedError,
  isTrialTimeoutAbortReason,
} from '../runtime/abort-reasons.js';
import { GraderAggregator } from './grader-aggregate.js';

class TrialTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Trial timed out after ${timeoutMs}ms`);
    this.name = 'TrialTimeoutError';
  }
}

class TrialAbortedError extends Error {
  constructor() {
    super('Trial aborted by parent.');
    this.name = 'TrialAbortedError';
  }
}

interface ClassifiedSystemError {
  code: SystemErrorCode;
  message: string;
  retryable: boolean;
}

function shouldShortCircuitOnAbort(reason: unknown): boolean {
  if (isTrialTimeoutAbortReason(reason)) {
    return true;
  }

  return isStreamClosedError(reason);
}

function classifySystemError(
  error: unknown,
  timeoutMs: number,
  signal: AbortSignal,
): ClassifiedSystemError {
  if (
    error instanceof TrialTimeoutError ||
    (signal.aborted && isTrialTimeoutAbortReason(signal.reason))
  ) {
    return {
      code: SYSTEM_ERROR_CODES.TIMEOUT,
      message: `Trial timed out after ${timeoutMs}ms`,
      retryable: false,
    };
  }

  if (signal.aborted) {
    return {
      code: SYSTEM_ERROR_CODES.ABORTED,
      message: 'Trial aborted by parent.',
      retryable: false,
    };
  }

  if (error instanceof Error) {
    return {
      code: SYSTEM_ERROR_CODES.PROVIDER_EXCEPTION,
      message: error.message,
      retryable: true,
    };
  }

  return {
    code: SYSTEM_ERROR_CODES.PROVIDER_EXCEPTION,
    message: String(error),
    retryable: true,
  };
}

export interface TrialExecutionInput {
  task: Task;
  run: Run;
  trialIndex: number;
  runId: string;
  timeoutMs: number;
  parentSignal?: AbortSignal;
}

export class TrialExecutor {
  private readonly aggregator: GraderAggregator;

  constructor(
    private readonly deps: {
      providers: Providers;
      graders: Graders;
    },
  ) {
    this.aggregator = new GraderAggregator(deps.graders);
  }

  async execute(input: TrialExecutionInput): Promise<Trial> {
    const startedAt = new Date().toISOString();
    const startMs = performance.now();

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeParentAbortListener: (() => void) | undefined;
    let removeAbortListener: (() => void) | undefined;

    if (input.parentSignal) {
      const parentSignal = input.parentSignal;
      if (parentSignal.aborted) {
        abortController.abort(parentSignal.reason);
      } else {
        const onParentAbort = () => abortController.abort(parentSignal.reason);
        input.parentSignal.addEventListener('abort', onParentAbort, { once: true });
        removeParentAbortListener = () =>
          input.parentSignal?.removeEventListener('abort', onParentAbort);
      }
    }

    const ctx: TaskContext = {
      taskId: input.task.id,
      trialIndex: input.trialIndex,
      runName: input.run.name,
      runId: input.runId,
      signal: abortController.signal,
    };

    let execution: ExecutionResult;

    try {
      const providerPromise = (async (): Promise<ExecutionResult> => {
        const provider = this.deps.providers.require(input.task.providerId);
        return ExecutionResult.from(await provider.execute(ctx, input.run));
      })();

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort(createTrialTimeoutAbortReason());
          reject(new TrialTimeoutError(input.timeoutMs));
        }, input.timeoutMs);
      });

      const abortPromise = new Promise<never>((_resolve, reject) => {
        const rejectIfShortCircuitReason = () => {
          if (shouldShortCircuitOnAbort(abortController.signal.reason)) {
            reject(new TrialAbortedError());
          }
        };

        if (abortController.signal.aborted) {
          rejectIfShortCircuitReason();
          return;
        }

        const onAbort = () => rejectIfShortCircuitReason();
        abortController.signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => abortController.signal.removeEventListener('abort', onAbort);
      });

      execution = await Promise.race([providerPromise, timeoutPromise, abortPromise]);
    } catch (error: unknown) {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      removeParentAbortListener?.();
      removeAbortListener?.();

      return this.buildFailedTrial(
        input,
        startedAt,
        startMs,
        new ExecutionResult({
          output: '',
          error: {
            type: 'system',
            ...classifySystemError(error, input.timeoutMs, abortController.signal),
          },
        }),
      );
    }

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    removeParentAbortListener?.();
    removeAbortListener?.();

    if (execution.error) {
      return this.buildFailedTrial(input, startedAt, startMs, execution);
    }

    try {
      const { graderResults, aggregate } = await this.aggregator.grade(
        execution,
        input.task.graderLayers,
        input.task.graderStrategy,
        input.task.passThreshold,
      );
      const endedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - startMs);

      return new Trial({
        taskId: input.task.id,
        runId: input.runId,
        runName: input.run.name,
        trialIndex: input.trialIndex,
        execution,
        graderResults,
        aggregate,
        timings: { startedAt, endedAt, durationMs },
      });
    } catch (error: unknown) {
      const endedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - startMs);

      return new Trial({
        taskId: input.task.id,
        runId: input.runId,
        runName: input.run.name,
        trialIndex: input.trialIndex,
        execution: new ExecutionResult({
          ...execution.toRecord(),
          error: {
            type: 'system',
            code: SYSTEM_ERROR_CODES.GRADER_EXCEPTION,
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        }),
        graderResults: [],
        aggregate: { pass: false },
        timings: { startedAt, endedAt, durationMs },
      });
    }
  }

  private buildFailedTrial(
    input: TrialExecutionInput,
    startedAt: string,
    startMs: number,
    execution: ExecutionResult,
  ): Trial {
    const endedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - startMs);

    return new Trial({
      taskId: input.task.id,
      runId: input.runId,
      runName: input.run.name,
      trialIndex: input.trialIndex,
      execution,
      graderResults: [],
      aggregate: { pass: false },
      timings: { startedAt, endedAt, durationMs },
    });
  }
}
