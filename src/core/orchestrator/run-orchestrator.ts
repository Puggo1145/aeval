import { randomUUID } from 'node:crypto';

import type { ObserverAdapter } from '../adapters/observer-adapter.js';
import type { ResultStoreAdapter } from '../adapters/result-store-adapter.js';
import type { ResolvedTask } from '../adapters/task-source-adapter.js';
import { SYSTEM_ERROR_CODES } from '../contracts/execution.js';
import type { RunManifest } from '../contracts/run-manifest.js';
import type { RunSummary } from '../contracts/run-summary.js';
import type {
  GraderRegistry,
  ProviderRegistry,
  RunEvent,
  RuntimeDefaults,
} from '../contracts/runtime.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import type { SuiteDefinition } from '../contracts/suite.js';
import type { TaskDefinition, TaskProviderConfig } from '../contracts/task.js';
import type { TrialResult } from '../contracts/trial.js';
import { isStreamClosedError, StreamClosedError } from '../runtime/abort-reasons.js';
import { resolveGraderOrThrow, resolveProviderOrThrow } from '../runtime/dependency-resolver.js';
import type { EffectiveExecutionConfig } from '../runtime/effective-execution.js';
import { computeSha256 } from '../utils/hash.js';
import { createBoundedAsyncChannel } from './bounded-async-channel.js';
import { cloneAndDeepFreezeRecord } from './immutable-input.js';
import { executeTrial } from './trial-engine.js';

export interface OrchestratorDeps {
  resultStoreAdapter: ResultStoreAdapter;
  observerAdapters: ObserverAdapter[];
  providerRegistry: ProviderRegistry;
  graderRegistry: GraderRegistry;
  runtimeDefaults: Required<RuntimeDefaults>;
}

export interface TaskRunOrchestratorInput {
  suite: SuiteDefinition;
  resolvedTask: ResolvedTask;
  run: TaskProviderConfig['runs'][number];
  execution: EffectiveExecutionConfig;
  signal?: AbortSignal;
}

const OBSERVER_NOTIFY_TIMEOUT_MS = 300;

export async function* orchestrateTaskRun(
  input: TaskRunOrchestratorInput,
  deps: OrchestratorDeps,
): AsyncGenerator<RunEvent> {
  const runId = randomUUID();
  const task = input.resolvedTask.task;
  const params = cloneAndDeepFreezeRecord(input.run.params);
  const taskHash = computeSha256(task);
  const configHash = computeSha256({
    taskId: task.id,
    providerId: task.provider.id,
    run: {
      name: input.run.name,
      params: input.run.params,
    },
    execution: input.execution,
  });

  const manifest: RunManifest = {
    schemaVersion: SCHEMA_VERSIONS.RUN_MANIFEST,
    runId,
    suiteId: input.suite.id,
    suiteName: input.suite.name,
    taskId: task.id,
    runName: input.run.name,
    taskSource: {
      adapter: input.resolvedTask.source.adapter,
      ref: input.resolvedTask.source.ref,
      revision: input.resolvedTask.source.revision,
    },
    taskHash,
    configHash,
    startedAt: new Date().toISOString(),
  };
  await deps.resultStoreAdapter.saveRunManifest(manifest);

  // run started
  const totalTrials = input.execution.trialsPerTask;
  const runStartedEvent: RunEvent = {
    type: 'run:started',
    runId,
    taskId: task.id,
    runName: input.run.name,
    totalTrials,
  };
  yield runStartedEvent;
  await notifyObservers(deps.observerAdapters, runStartedEvent);

  const completedTrials: TrialResult[] = [];
  const runAbortController = new AbortController();
  const trialIndices = Array.from({ length: totalTrials }, (_, index) => index);
  const trialIterator = trialIndices[Symbol.iterator]();
  const activeWorkers: Promise<void>[] = [];
  const eventQueueCapacity = Math.max(input.execution.maxConcurrency * 4, 32);
  // 使用有界背压队列来缓冲 event，避免使用 stream 接口的消费者消费太慢导致内存溢出
  const eventChannel = createBoundedAsyncChannel<RunEvent>(eventQueueCapacity);
  let allDonePromise: Promise<void> | undefined;
  let fatalWorkerError: unknown;
  let removeInputAbortListener: (() => void) | undefined;

  const abortRunFromInputSignal = (): void => {
    if (!runAbortController.signal.aborted) {
      const reason = input.signal?.reason;
      runAbortController.abort(isStreamClosedError(reason) ? reason : new StreamClosedError());
    }
    eventChannel.close();
  };

  if (input.signal) {
    if (input.signal.aborted) {
      abortRunFromInputSignal();
    } else {
      const onInputAbort = () => abortRunFromInputSignal();
      input.signal.addEventListener('abort', onInputAbort, { once: true });
      removeInputAbortListener = () => input.signal?.removeEventListener('abort', onInputAbort);
    }
  }

  async function pushEvent(event: RunEvent): Promise<void> {
    if (runAbortController.signal.aborted) {
      return;
    }
    await eventChannel.push(event);
  }

  async function runWorker(): Promise<void> {
    while (true) {
      if (runAbortController.signal.aborted) {
        break;
      }

      const next = trialIterator.next();
      if (next.done) {
        break;
      }

      const trialIndex = next.value;

      try {
        const startedEvent: RunEvent = {
          type: 'trial:started',
          taskId: task.id,
          runId,
          runName: input.run.name,
          trialIndex,
        };
        await pushEvent(startedEvent);

        let result = await executeSingleTrial(
          task,
          params,
          trialIndex,
          input.execution.timeoutMs,
          runId,
          input.run.name,
          deps,
          runAbortController.signal,
        );

        // 执行完一个 trial 后如果失败，根据可重试配置进行重试
        let retryCount = 0;
        while (
          !runAbortController.signal.aborted &&
          isRetryableSystemError(result) &&
          retryCount < input.execution.retryOnError
        ) {
          retryCount++;
          result = await executeSingleTrial(
            task,
            params,
            trialIndex,
            input.execution.timeoutMs,
            runId,
            input.run.name,
            deps,
            runAbortController.signal,
          );
        }

        if (runAbortController.signal.aborted) {
          break;
        }

        completedTrials.push(result);
        await deps.resultStoreAdapter.saveTrial({ runId, trial: result });

        if (result.execution.error) {
          const event: RunEvent = {
            type: 'trial:error',
            taskId: task.id,
            runId,
            runName: input.run.name,
            trialIndex,
            errorType: result.execution.error.type,
            message: result.execution.error.message,
          };
          await pushEvent(event);
          await notifyObservers(deps.observerAdapters, event);
        } else {
          const event: RunEvent = {
            type: 'trial:completed',
            taskId: task.id,
            runId,
            runName: input.run.name,
            trialIndex,
            pass: result.aggregate.pass,
            durationMs: result.timings.durationMs,
          };
          await pushEvent(event);
          await notifyObservers(deps.observerAdapters, event);
        }
      } catch (error: unknown) {
        fatalWorkerError = fatalWorkerError ?? error;
        if (!runAbortController.signal.aborted) {
          runAbortController.abort(error);
        }
        break;
      }
    }
  }

  try {
    // 激活 worker 开始跑 trial
    const workerCount = Math.min(input.execution.maxConcurrency, trialIndices.length);
    for (let index = 0; index < workerCount; index++) {
      activeWorkers.push(runWorker());
    }

    allDonePromise = Promise.allSettled(activeWorkers).then(() => {
      eventChannel.close();
    });

    for await (const event of eventChannel) {
      yield event;
    }

    if (isStreamClosedError(runAbortController.signal.reason)) {
      return;
    }

    await allDonePromise;
    if (fatalWorkerError) {
      throw fatalWorkerError;
    }

    const summary = aggregateRunSummary(runId, task.id, input.run.name, completedTrials);
    await deps.resultStoreAdapter.saveRunSummary({ runId, summary });

    manifest.completedAt = new Date().toISOString();
    await deps.resultStoreAdapter.saveRunManifest(manifest);

    const completedEvent: RunEvent = {
      type: 'run:completed',
      summary,
    };
    yield completedEvent;
    await notifyObservers(deps.observerAdapters, completedEvent);
  } finally {
    removeInputAbortListener?.();

    if (!runAbortController.signal.aborted) {
      runAbortController.abort(new StreamClosedError());
    }
    eventChannel.close();

    if (allDonePromise) {
      await allDonePromise;
    }
  }
}

async function executeSingleTrial(
  task: TaskDefinition,
  params: Readonly<Record<string, unknown>>,
  trialIndex: number,
  timeoutMs: number,
  runId: string,
  runName: string,
  deps: OrchestratorDeps,
  parentSignal?: AbortSignal,
): Promise<TrialResult> {
  return executeTrial(
    {
      task,
      params,
      trialIndex,
      runId,
      runName,
      timeoutMs,
      parentSignal,
    },
    {
      resolveProvider: (id) => resolveProviderOrThrow(id, deps.providerRegistry),
      resolveGrader: (type) => resolveGraderOrThrow(type, deps.graderRegistry),
    },
  );
}

function aggregateRunSummary(
  runId: string,
  taskId: string,
  runName: string,
  trials: TrialResult[],
): RunSummary {
  const totalTrials = trials.length;
  const passedTrials = trials.filter((trial) => trial.aggregate.pass).length;
  const anyPass = trials.some((trial) => trial.aggregate.pass);
  const allPass = trials.every((trial) => trial.aggregate.pass);
  const latencyValues = trials
    .map((trial) => trial.execution.metrics?.latencyMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const passRate = totalTrials > 0 ? passedTrials / totalTrials : 0;
  // pass@k 至少成功一次（trial 大于 1 才有意义）
  const passAtK = totalTrials > 1 ? (anyPass ? 1 : 0) : undefined;
  // pass^k 全部成功（trial 大于 1 才有意义）
  const passHatK = totalTrials > 1 ? (allPass ? 1 : 0) : undefined;
  const avgLatencyMs =
    latencyValues.length > 0
      ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
      : undefined;

  return {
    schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
    runId,
    taskId,
    runName,
    totalTrials,
    passRate,
    ...(passAtK !== undefined ? { passAtK } : {}),
    ...(passHatK !== undefined ? { passHatK } : {}),
    ...(avgLatencyMs !== undefined ? { avgLatencyMs } : {}),
  };
}

function isRetryableSystemError(result: TrialResult): boolean {
  const error = result.execution.error;
  if (!error || error.type !== 'system') {
    return false;
  }

  // timeout 认为不可重试
  if (error.code === SYSTEM_ERROR_CODES.TIMEOUT) {
    return false;
  }

  if (error.retryable !== undefined) {
    return error.retryable;
  }

  return true;
}

async function notifyObservers(observers: ObserverAdapter[], event: RunEvent): Promise<void> {
  if (observers.length === 0) {
    return;
  }

  await Promise.all(observers.map((observer) => notifyObserverWithTimeout(observer, event)));
}

async function notifyObserverWithTimeout(
  observer: ObserverAdapter,
  event: RunEvent,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let completed = false;
    const timeoutId = setTimeout(() => {
      if (!completed) {
        completed = true;
        resolve();
      }
    }, OBSERVER_NOTIFY_TIMEOUT_MS);

    Promise.resolve()
      .then(() => observer.onEvent(event))
      .catch(() => undefined)
      .finally(() => {
        if (completed) {
          return;
        }

        completed = true;
        clearTimeout(timeoutId);
        resolve();
      });
  });
}
