import { randomUUID } from 'node:crypto';

import type { Observer } from '../adapters/observer-adapter.js';
import type { Stores } from '../adapters/result-store-adapter.js';
import { SYSTEM_ERROR_CODES } from '../contracts/execution.js';
import type { Graders, Providers, RunEvent } from '../contracts/runtime.js';
import type { Run } from '../domain/run.js';
import { RunManifest } from '../domain/run-manifest.js';
import { RunSummary } from '../domain/run-summary.js';
import type { Suite } from '../domain/suite.js';
import type { Task } from '../domain/task.js';
import type { Trial } from '../domain/trial.js';
import { isStreamClosedError, StreamClosedError } from '../runtime/abort-reasons.js';
import type { ExecutionPolicy } from '../runtime/task-execution.js';
import { BoundedAsyncChannel } from './bounded-async-channel.js';
import { TrialExecutor } from './trial-engine.js';

export interface TaskRunOrchestratorInput {
  suite: Suite;
  task: Task;
  run: Run;
  execution: ExecutionPolicy;
  signal?: AbortSignal;
}

const OBSERVER_NOTIFY_TIMEOUT_MS = 300;

export class TaskRunOrchestrator {
  constructor(
    private readonly input: TaskRunOrchestratorInput,
    private readonly deps: {
      stores: Stores;
      observers: readonly Observer[];
      providers: Providers;
      graders: Graders;
    },
  ) {}

  async *run(): AsyncGenerator<RunEvent> {
    const { task, run, execution } = this.input;
    const runId = randomUUID();
    let manifest = RunManifest.create({
      runId,
      suite: this.input.suite,
      task,
      run,
      execution,
    });
    const totalTrials = execution.trialsPerTask;
    const completedTrials: Trial[] = [];
    const runAbortController = new AbortController();
    const trialIterator = Array.from({ length: totalTrials }, (_, index) => index)[
      Symbol.iterator
    ]();
    const eventChannel = new BoundedAsyncChannel<RunEvent>(
      Math.max(execution.maxConcurrency * 4, 32),
    );
    const executor = new TrialExecutor({
      providers: this.deps.providers,
      graders: this.deps.graders,
    });
    let allDonePromise: Promise<void> | undefined;
    let fatalWorkerError: unknown;
    let removeInputAbortListener: (() => void) | undefined;

    const abortRunFromInputSignal = (): void => {
      if (!runAbortController.signal.aborted) {
        const reason = this.input.signal?.reason;
        runAbortController.abort(isStreamClosedError(reason) ? reason : new StreamClosedError());
      }
      eventChannel.close();
    };
    await this.deps.stores.saveRunManifest(manifest.toRecord());

    const notify = (event: RunEvent): Promise<void> => notifyObservers(this.deps.observers, event);

    const runStartedEvent: RunEvent = {
      type: 'run:started',
      runId,
      taskId: task.id,
      runName: run.name,
      totalTrials,
    };
    yield runStartedEvent;
    await notify(runStartedEvent);

    if (this.input.signal) {
      if (this.input.signal.aborted) {
        abortRunFromInputSignal();
      } else {
        const onInputAbort = () => abortRunFromInputSignal();
        this.input.signal.addEventListener('abort', onInputAbort, { once: true });
        removeInputAbortListener = () =>
          this.input.signal?.removeEventListener('abort', onInputAbort);
      }
    }

    // Single emission path for worker events: stream consumers read from the
    // channel while observers are notified best-effort with a timeout.
    const emit = async (event: RunEvent): Promise<void> => {
      if (runAbortController.signal.aborted) {
        return;
      }
      await eventChannel.push(event);
      await notify(event);
    };

    const runWorker = async (): Promise<void> => {
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
          await emit({
            type: 'trial:started',
            taskId: task.id,
            runId,
            runName: run.name,
            trialIndex,
          });

          let result = await executor.execute({
            task,
            run,
            trialIndex,
            runId,
            timeoutMs: execution.timeoutMs,
            parentSignal: runAbortController.signal,
          });

          let retryCount = 0;
          while (
            !runAbortController.signal.aborted &&
            isRetryableSystemError(result) &&
            retryCount < execution.retryOnError
          ) {
            retryCount++;
            result = await executor.execute({
              task,
              run,
              trialIndex,
              runId,
              timeoutMs: execution.timeoutMs,
              parentSignal: runAbortController.signal,
            });
          }

          if (runAbortController.signal.aborted) {
            break;
          }

          completedTrials.push(result);
          await this.deps.stores.saveTrial({ runId, trial: result.toRecord() });

          if (result.execution.error) {
            await emit({
              type: 'trial:error',
              taskId: task.id,
              runId,
              runName: run.name,
              trialIndex,
              errorType: result.execution.error.type,
              message: result.execution.error.message,
            });
          } else {
            await emit({
              type: 'trial:completed',
              taskId: task.id,
              runId,
              runName: run.name,
              trialIndex,
              pass: result.aggregate.pass,
              durationMs: result.timings.durationMs,
            });
          }
        } catch (error: unknown) {
          fatalWorkerError = fatalWorkerError ?? error;
          if (!runAbortController.signal.aborted) {
            runAbortController.abort(error);
          }
          break;
        }
      }
    };

    try {
      const workerCount = Math.min(execution.maxConcurrency, totalTrials);
      const activeWorkers: Promise<void>[] = [];
      for (let index = 0; index < workerCount; index++) {
        activeWorkers.push(runWorker());
      }

      allDonePromise = Promise.allSettled(activeWorkers).then(() => {
        eventChannel.close();
      });

      for await (const event of eventChannel) {
        yield event;
      }

      if (this.input.signal?.aborted || isStreamClosedError(runAbortController.signal.reason)) {
        return;
      }

      await allDonePromise;
      if (fatalWorkerError) {
        throw fatalWorkerError;
      }

      const summary = RunSummary.fromTrials(runId, task.id, run.name, completedTrials);
      await this.deps.stores.saveRunSummary({ runId, summary: summary.toRecord() });

      manifest = manifest.complete();
      await this.deps.stores.saveRunManifest(manifest.toRecord());

      const completedEvent: RunEvent = { type: 'run:completed', summary: summary.toRecord() };
      yield completedEvent;
      await notify(completedEvent);
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
}

function isRetryableSystemError(result: Trial): boolean {
  const error = result.execution.error;
  if (!error || error.type !== 'system') {
    return false;
  }

  if (error.code === SYSTEM_ERROR_CODES.TIMEOUT) {
    return false;
  }

  if (error.retryable !== undefined) {
    return error.retryable;
  }

  return true;
}

async function notifyObservers(observers: readonly Observer[], event: RunEvent): Promise<void> {
  if (observers.length === 0) {
    return;
  }

  await Promise.all(observers.map((observer) => notifyObserverWithTimeout(observer, event)));
}

// Observers are best-effort: a slow or throwing observer must not stall the run.
async function notifyObserverWithTimeout(observer: Observer, event: RunEvent): Promise<void> {
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
