import {
  type ExecutionResult,
  SYSTEM_ERROR_CODES,
  type SystemErrorCode,
} from '../contracts/execution.js';
import type { Grader, TaskContext } from '../contracts/runtime.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import type { TaskDefinition } from '../contracts/task.js';
import type { TrialResult } from '../contracts/trial.js';
import { aggregateGraders } from './grader-aggregate.js';

class TrialTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Trial timed out after ${timeoutMs}ms`);
    this.name = 'TrialTimeoutError';
  }
}

interface ClassifiedSystemError {
  code: SystemErrorCode;
  message: string;
  retryable: boolean;
}

function classifySystemError(
  error: unknown,
  timeoutMs: number,
  signal: AbortSignal,
): ClassifiedSystemError {
  if (error instanceof TrialTimeoutError || (signal.aborted && signal.reason === 'timeout')) {
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

export interface TrialExecutionDeps {
  resolveProvider: (
    providerId: string,
  ) => (ctx: TaskContext, params: Readonly<Record<string, unknown>>) => Promise<ExecutionResult>;
  resolveGrader: (type: string) => Grader;
}

export interface TrialExecutionInput {
  task: TaskDefinition;
  trialIndex: number;
  runId: string;
  runName: string;
  overrides: Readonly<Record<string, unknown>>;
  timeoutMs: number;
  parentSignal?: AbortSignal;
}

/**
 * 执行单次 trial：provider 执行 -> grading -> TrialResult。
 *
 * 通过 AbortSignal 处理超时，并将失败归类为 agent/system。
 * 无论成功或失败，都返回 TrialResult。
 */
export async function executeTrial(
  input: TrialExecutionInput,
  deps: TrialExecutionDeps,
): Promise<TrialResult> {
  const startedAt = new Date().toISOString();
  const startMs = performance.now();

  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeParentAbortListener: (() => void) | undefined;

  // 将父级 signal 透传到当前 trial 的 abort controller
  if (input.parentSignal) {
    // 保存一个指针，对 TS 确保 signal 不会被 GC 回收
    const parentSignal = input.parentSignal;
    // 父级 abort 已经中止，终止当前 trial 并使用和父级相同的 reason
    if (parentSignal.aborted) {
      abortController.abort(parentSignal.reason);
    } else {
      // 父级暂未终止，监听父级 abort 事件，并使用和父级相同的 reason 中止当前 trial
      const onParentAbort = () => abortController.abort(parentSignal.reason);
      input.parentSignal.addEventListener('abort', onParentAbort, { once: true });
      removeParentAbortListener = () =>
        input.parentSignal?.removeEventListener('abort', onParentAbort);
    }
  }

  const ctx: TaskContext = {
    taskId: input.task.id,
    trialIndex: input.trialIndex,
    runName: input.runName,
    runId: input.runId,
    overrides: input.overrides,
    signal: abortController.signal,
  };

  let execution: ExecutionResult;

  try {
    const providerPromise = (async (): Promise<ExecutionResult> => {
      const provider = deps.resolveProvider(input.task.provider.id);
      const params = input.task.provider.params ?? {};
      return provider(ctx, params);
    })();

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort('timeout');
        reject(new TrialTimeoutError(input.timeoutMs));
      }, input.timeoutMs);
    });

    execution = await Promise.race([providerPromise, timeoutPromise]);
  } catch (error: unknown) {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    removeParentAbortListener?.();
    const endedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - startMs);

    const classified = classifySystemError(error, input.timeoutMs, abortController.signal);
    execution = {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: '',
      error: {
        type: 'system',
        code: classified.code,
        message: classified.message,
        retryable: classified.retryable,
      },
    };

    // 出错时跳过 grading，trial 直接判定为失败
    return {
      schemaVersion: SCHEMA_VERSIONS.TRIAL_RESULT,
      taskId: input.task.id,
      runId: input.runId,
      runName: input.runName,
      trialIndex: input.trialIndex,
      execution,
      graderResults: [],
      aggregate: { pass: false },
      timings: { startedAt, endedAt, durationMs },
    };
  }

  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  removeParentAbortListener?.();

  // provider 已返回 execution.error 时，跳过 grading
  if (execution.error) {
    const endedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - startMs);

    return {
      schemaVersion: SCHEMA_VERSIONS.TRIAL_RESULT,
      taskId: input.task.id,
      runId: input.runId,
      runName: input.runName,
      trialIndex: input.trialIndex,
      execution,
      graderResults: [],
      aggregate: { pass: false },
      timings: { startedAt, endedAt, durationMs },
    };
  }

  // 对 execution 进行 grading
  try {
    const { graderResults, aggregate } = await aggregateGraders({
      execution,
      layers: input.task.graders.layers,
      strategy: input.task.graders.strategy,
      passThreshold:
        'passThreshold' in input.task.graders ? input.task.graders.passThreshold : undefined,
      resolveGrader: deps.resolveGrader,
    });

    const endedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - startMs);

    return {
      schemaVersion: SCHEMA_VERSIONS.TRIAL_RESULT,
      taskId: input.task.id,
      runId: input.runId,
      runName: input.runName,
      trialIndex: input.trialIndex,
      execution,
      graderResults,
      aggregate,
      timings: { startedAt, endedAt, durationMs },
    };
  } catch (error: unknown) {
    const endedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - startMs);

    return {
      schemaVersion: SCHEMA_VERSIONS.TRIAL_RESULT,
      taskId: input.task.id,
      runId: input.runId,
      runName: input.runName,
      trialIndex: input.trialIndex,
      execution: {
        ...execution,
        error: {
          type: 'system',
          code: SYSTEM_ERROR_CODES.GRADER_EXCEPTION,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      },
      graderResults: [],
      aggregate: { pass: false },
      timings: { startedAt, endedAt, durationMs },
    };
  }
}
