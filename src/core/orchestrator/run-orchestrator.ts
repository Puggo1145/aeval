// youeval 的调度核心，负责把一次 run 从头跑到尾

import { randomUUID } from 'node:crypto';

import type { ObserverAdapter } from '../adapters/observer-adapter.js';
import type { ResultStoreAdapter } from '../adapters/result-store-adapter.js';
import type { DatasetSelector, ResolvedDataset, TaskSourceAdapter } from '../adapters/task-source-adapter.js';
import { SYSTEM_ERROR_CODES } from '../contracts/execution.js';
import type { ExperimentDefinition } from '../contracts/experiment.js';
import type { RunManifest } from '../contracts/run-manifest.js';
import type { RunSummary } from '../contracts/run-summary.js';
import type { GraderRegistry, ProviderRegistry, RunEvent } from '../contracts/runtime.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import type { TaskDefinition } from '../contracts/task.js';
import type { TrialResult } from '../contracts/trial.js';
import { RuntimeError, ValidationError } from '../errors/index.js';
import { StreamClosedError, isStreamClosedError } from '../runtime/abort-reasons.js';
import { resolveGraderOrThrow, resolveProviderOrThrow } from '../runtime/dependency-resolver.js';
import { validateTaskDefinitions } from '../validation/task-validator.js';
import { createBoundedAsyncChannel } from './bounded-async-channel.js';
import { computeConfigHash } from './config-hash.js';
import { cloneAndDeepFreezeRecord } from './immutable-input.js';
import { executeTrial } from './trial-engine.js';

export interface OrchestratorDeps {
  taskSourceAdapter: TaskSourceAdapter;
  resultStoreAdapter: ResultStoreAdapter;
  observerAdapters: ObserverAdapter[];
  providerRegistry: ProviderRegistry;
  graderRegistry: GraderRegistry;
}

export interface OrchestratorInput {
  experiment: ExperimentDefinition;
  runName: string;
  signal?: AbortSignal;
}

const OBSERVER_NOTIFY_TIMEOUT_MS = 300;

interface GraderConfigValidationResult {
  valid: boolean;
  reason?: string;
}

interface GraderWithConfigValidator {
  validateConfig?: (config: Record<string, unknown>) => GraderConfigValidationResult;
}

/**
 * 以异步事件流方式执行一次完整的评测 run。
 *
 * 生命周期：
 *   1. 解析数据集（失败即终止）
 *   2. 校验 tasks
 *   3. 保存 run manifest
 *   4. 并发执行 trials（受 maxConcurrency 限制）
 *   5. 聚合生成 RunSummary
 *   6. 保存 run summary
 *   7. 发出 run:completed 事件
 */
export async function* orchestrateRun(
  input: OrchestratorInput,
  deps: OrchestratorDeps,
): AsyncGenerator<RunEvent> {
  const runId = randomUUID();
  const runConfig = input.experiment.runs.find((r) => r.name === input.runName);
  if (!runConfig) {
    throw new ValidationError(`Run '${input.runName}' is not defined in 'experiment.runs'.`, {
      details: {
        field: 'runName',
        runName: input.runName,
        knownRuns: input.experiment.runs.map((run) => run.name),
      },
    });
  }
  const overrides = cloneAndDeepFreezeRecord(runConfig.overrides);

  // 1. run 启动前先解析数据集，失败即终止
  const selector: DatasetSelector = {
    dataset: input.experiment.dataset,
    revision: input.experiment.revision,
    tag: input.experiment.tag,
  };
  let resolved: ResolvedDataset;
  try {
    resolved = await deps.taskSourceAdapter.resolveDataset(selector);
  } catch (cause) {
    const message =
      cause instanceof Error && cause.message.trim().length > 0 ? cause.message : 'Unknown error.';
    throw new RuntimeError(`Task source adapter dataset resolution failed: ${message}`, {
      details: {
        field: 'experiment.taskSource',
      },
      cause,
    });
  }

  // 2. 校验任务定义
  const tasks = validateTaskDefinitions(resolved.tasks, {
    isProviderRegistered: (id) => deps.providerRegistry.has(id),
    listProviderIds: () => deps.providerRegistry.list(),
    datasetRevision: resolved.source.revision,
  }).map((task) => ({
    ...task,
    provider: {
      ...task.provider,
      // deep copy 并冻结 provider 的覆盖参数，避免运行时跨 trial 修改影响其他 trial
      params: cloneAndDeepFreezeRecord(task.provider.params),
    },
  }));

  // 校验所有 task 的 grader type 都可解析
  for (const task of tasks) {
    for (const [layerIndex, layer] of task.graders.layers.entries()) {
      const grader = resolveGraderOrThrow(layer.type, deps.graderRegistry);
      const configValidator = (grader as typeof grader & GraderWithConfigValidator).validateConfig;
      const validation = configValidator?.(cloneAndDeepFreezeRecord(layer.config));
      if (validation && !validation.valid) {
        throw new ValidationError(
          `Invalid config for grader '${layer.type}' on task '${task.id}': ${validation.reason ?? 'Unknown config error.'}`,
          {
            details: {
              field: `task.graders.layers[${layerIndex}].config`,
              taskId: task.id,
              graderType: layer.type,
              layerName: layer.name,
            },
          },
        );
      }
    }
  }

  // 3. 保存 run manifest
  const configHash = computeConfigHash(input.experiment);
  const startedAt = new Date().toISOString();
  const manifest: RunManifest = {
    schemaVersion: SCHEMA_VERSIONS.RUN_MANIFEST,
    runId,
    experimentName: input.experiment.name,
    taskSource: {
      adapter: resolved.source.adapter,
      ref: resolved.source.ref,
      revision: resolved.source.revision,
    },
    datasetHash: resolved.datasetHash,
    configHash,
    startedAt,
  };
  await deps.resultStoreAdapter.saveRunManifest(manifest);

  // 计算每个 task 的 trial 数（experiment 级别）
  const trialsPerTask = input.experiment.trialsPerTask ?? 1;

  // 生成完整 trial 工作队列
  const trialWork: Array<{ task: TaskDefinition; trialIndex: number }> = [];
  for (const task of tasks) {
    // task 级别可覆盖 experiment 级别
    const taskTrials = task.execution.trialsPerTask ?? trialsPerTask;
    for (let i = 0; i < taskTrials; i++) {
      trialWork.push({ task, trialIndex: i });
    }
  }

  // 4. 发出 run:started
  yield {
    type: 'run:started',
    runId,
    runName: input.runName,
    totalTasks: tasks.length,
  };
  await notifyObservers(deps.observerAdapters, {
    type: 'run:started',
    runId,
    runName: input.runName,
    totalTasks: tasks.length,
  });

  // 5. 并发执行 trials
  const maxConcurrency = input.experiment.maxConcurrency;
  const completedTrials: TrialResult[] = [];
  const timeoutMs = input.experiment.timeoutMs;
  const runAbortController = new AbortController();

  // 使用迭代器 + worker 的方式限制并发
  const trialIterator = trialWork[Symbol.iterator]();
  const activeWorkers: Promise<void>[] = [];

  // worker 事件通道，避免慢消费方导致无限堆积
  const eventQueueCapacity = Math.max(maxConcurrency * 4, 32);
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
      if (next.done) break;

      const { task, trialIndex } = next.value;
      const taskTimeoutMs = timeoutMs ?? task.execution.timeoutMs;
      const retryOnError = task.execution.retryOnError ?? 0;

      try {
        await pushEvent({
          type: 'trial:started',
          taskId: task.id,
          trialIndex,
        });

        if (runAbortController.signal.aborted) {
          break;
        }

        let result = await executeSingleTrial(
          task,
          trialIndex,
          taskTimeoutMs,
          runId,
          input.runName,
          overrides,
          deps,
          runAbortController.signal,
        );

        // 仅重试可重试的 system 错误；timeout 不重试，避免并发重入副作用
        let retryCount = 0;
        while (
          !runAbortController.signal.aborted &&
          isRetryableSystemError(result) &&
          retryCount < retryOnError
        ) {
          retryCount++;
          result = await executeSingleTrial(
            task,
            trialIndex,
            taskTimeoutMs,
            runId,
            input.runName,
            overrides,
            deps,
            runAbortController.signal,
          );
        }

        if (runAbortController.signal.aborted) {
          break;
        }

        completedTrials.push(result);

        // 持久化 trial
        await deps.resultStoreAdapter.saveTrial({ runId, trial: result });

        if (runAbortController.signal.aborted) {
          break;
        }

        // 发出 trial 事件
        if (result.execution.error) {
          const event: RunEvent = {
            type: 'trial:error',
            taskId: task.id,
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
    // 按 maxConcurrency 启动 workers
    const workerCount = Math.min(maxConcurrency, trialWork.length);
    for (let i = 0; i < workerCount; i++) {
      activeWorkers.push(runWorker());
    }

    // 等待 workers 结束，并在结束后关闭事件通道
    allDonePromise = Promise.allSettled(activeWorkers).then(() => {
      eventChannel.close();
    });

    // 按到达顺序输出事件
    for await (const queuedEvent of eventChannel) {
      yield queuedEvent;
    }

    if (isStreamClosedError(runAbortController.signal.reason)) {
      return;
    }

    await allDonePromise;
    if (fatalWorkerError) {
      throw fatalWorkerError;
    }

    // 6. 聚合 run summary
    const summary = aggregateRunSummary(runId, input.runName, tasks, completedTrials);

    // 7. 保存 run summary
    await deps.resultStoreAdapter.saveRunSummary({ runId, summary });

    // 更新 manifest 完成时间
    manifest.completedAt = new Date().toISOString();
    await deps.resultStoreAdapter.saveRunManifest(manifest);

    // 8. 发出 run:completed
    const completedEvent: RunEvent = { type: 'run:completed', summary };
    yield completedEvent;
    await notifyObservers(deps.observerAdapters, completedEvent);
  } finally {
    removeInputAbortListener?.();

    // stream 提前关闭时也要主动收敛 worker，避免后台继续执行
    if (!runAbortController.signal.aborted) {
      runAbortController.abort(new StreamClosedError());
    }
    eventChannel.close();

    // workers 已通过 runAbortController.abort() 收到中止信号，
    // trial-engine 的 abortPromise race 确保即使 provider 不协作也能快速短路，
    // 因此这里安全等待 workers 结束，避免资源泄漏。
    if (allDonePromise) {
      await allDonePromise;
    }
  }
}

async function executeSingleTrial(
  task: TaskDefinition,
  trialIndex: number,
  timeoutMs: number,
  runId: string,
  runName: string,
  overrides: Readonly<Record<string, unknown>>,
  deps: OrchestratorDeps,
  parentSignal?: AbortSignal,
): Promise<TrialResult> {
  return executeTrial(
    {
      task,
      trialIndex,
      runId,
      runName,
      overrides,
      timeoutMs,
      parentSignal,
    },
    {
      resolveProvider: (id) => resolveProviderOrThrow(id, deps.providerRegistry),
      resolveGrader: (type) => resolveGraderOrThrow(type, deps.graderRegistry),
    },
  );
}

/**
 * 将已完成的 trials 聚合为 RunSummary。
 *
 * 指标定义：
 *   - passRate: 至少 1 次 trial 通过的 task 占比
 *   - passAtK: 至少 1 次通过的 task 占比（经验口径下与 passRate 一致）
 *   - passHatK: 全部 trials 都通过的 task 占比
 *   - avgLatencyMs: 有 latency 数据的 trial 平均值
 */
function aggregateRunSummary(
  runId: string,
  runName: string,
  tasks: TaskDefinition[],
  trials: TrialResult[],
): RunSummary {
  if (tasks.length === 0) {
    return {
      schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
      runId,
      runName,
      totalTasks: 0,
      totalTrials: trials.length,
      passRate: 0,
    };
  }

  // 按 taskId 聚合 trial
  const trialsByTask = new Map<string, TrialResult[]>();
  for (const trial of trials) {
    const existing = trialsByTask.get(trial.taskId) ?? [];
    existing.push(trial);
    trialsByTask.set(trial.taskId, existing);
  }

  let passAtKCount = 0; // 至少 1 次通过的 task 数
  let passHatKCount = 0; // 全部通过的 task 数
  let hasMultipleTrials = false;

  for (const task of tasks) {
    const taskTrials = trialsByTask.get(task.id) ?? [];
    if (taskTrials.length === 0) continue;

    if (taskTrials.length > 1) hasMultipleTrials = true;

    const anyPass = taskTrials.some((t) => t.aggregate.pass);
    const allPass = taskTrials.every((t) => t.aggregate.pass);

    if (anyPass) passAtKCount++;
    if (allPass) passHatKCount++;
  }

  const passRate = passAtKCount / tasks.length;

  // 计算平均 latency
  const latencies: number[] = [];
  for (const trial of trials) {
    if (trial.execution.metrics?.latencyMs !== undefined) {
      latencies.push(trial.execution.metrics.latencyMs);
    }
  }
  const avgLatencyMs =
    latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : undefined;

  const summary: RunSummary = {
    schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
    runId,
    runName,
    totalTasks: tasks.length,
    totalTrials: trials.length,
    passRate,
  };

  // 只有存在多次 trial 时才输出 pass@k/pass^k
  if (hasMultipleTrials) {
    summary.passAtK = passAtKCount / tasks.length;
    summary.passHatK = passHatKCount / tasks.length;
  }

  if (avgLatencyMs !== undefined) {
    summary.avgLatencyMs = avgLatencyMs;
  }

  return summary;
}

function isRetryableSystemError(result: TrialResult): boolean {
  const error = result.execution.error;
  if (!error || error.type !== 'system') {
    return false;
  }

  // timeout 在 v1 语义里始终不可重试，优先级高于 retryable 字段
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
