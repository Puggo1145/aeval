import { randomUUID } from 'node:crypto';

import type { Observer } from '../adapters/observer-adapter.js';
import type { Stores } from '../adapters/result-store-adapter.js';
import { SYSTEM_ERROR_CODES } from '../contracts/execution.js';
import type { Graders, Providers } from '../contracts/runtime.js';
import type { Run } from '../domain/run.js';
import {
  RunCompletedEvent,
  type RunEvent,
  RunStartedEvent,
  TrialCompletedEvent,
  TrialErrorEvent,
  TrialStartedEvent,
} from '../domain/run-event.js';
import { RunManifest } from '../domain/run-manifest.js';
import { RunSummary } from '../domain/run-summary.js';
import type { Suite } from '../domain/suite.js';
import type { Task } from '../domain/task.js';
import type { Trial } from '../domain/trial.js';
import { isStreamClosedError, StreamClosedError } from '../runtime/abort-reasons.js';
import type { ExecutionPolicy } from '../runtime/task-execution.js';
import { createBoundedAsyncChannel } from './bounded-async-channel.js';
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
      observers: Observer[];
      providers: Providers;
      graders: Graders;
    },
  ) {}

  async *run(): AsyncGenerator<RunEvent> {
    const runId = randomUUID();
    let manifest = RunManifest.create({
      runId,
      suite: this.input.suite,
      task: this.input.task,
      run: this.input.run,
      execution: this.input.execution,
    });
    await this.deps.stores.saveRunManifest(manifest.toRecord());

    const totalTrials = this.input.execution.trialsPerTask;
    const runStartedEvent = new RunStartedEvent(
      runId,
      this.input.task.id,
      this.input.run.name,
      totalTrials,
    );
    yield runStartedEvent;
    await notifyObservers(this.deps.observers, runStartedEvent);

    const completedTrials: Trial[] = [];
    const runAbortController = new AbortController();
    const trialIndices = Array.from({ length: totalTrials }, (_, index) => index);
    const trialIterator = trialIndices[Symbol.iterator]();
    const activeWorkers: Promise<void>[] = [];
    const eventChannel = createBoundedAsyncChannel<RunEvent>(
      Math.max(this.input.execution.maxConcurrency * 4, 32),
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

    const pushEvent = async (event: RunEvent): Promise<void> => {
      if (runAbortController.signal.aborted) {
        return;
      }
      await eventChannel.push(event);
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
          await pushEvent(
            new TrialStartedEvent(this.input.task.id, runId, this.input.run.name, trialIndex),
          );

          let result = await executor.execute({
            task: this.input.task,
            run: this.input.run,
            trialIndex,
            runId,
            timeoutMs: this.input.execution.timeoutMs,
            parentSignal: runAbortController.signal,
          });

          let retryCount = 0;
          while (
            !runAbortController.signal.aborted &&
            isRetryableSystemError(result) &&
            retryCount < this.input.execution.retryOnError
          ) {
            retryCount++;
            result = await executor.execute({
              task: this.input.task,
              run: this.input.run,
              trialIndex,
              runId,
              timeoutMs: this.input.execution.timeoutMs,
              parentSignal: runAbortController.signal,
            });
          }

          if (runAbortController.signal.aborted) {
            break;
          }

          completedTrials.push(result);
          await this.deps.stores.saveTrial({ runId, trial: result.toRecord() });

          if (result.execution.error) {
            const event = new TrialErrorEvent(
              this.input.task.id,
              runId,
              this.input.run.name,
              trialIndex,
              result.execution.error.type,
              result.execution.error.message,
            );
            await pushEvent(event);
            await notifyObservers(this.deps.observers, event);
          } else {
            const event = new TrialCompletedEvent(
              this.input.task.id,
              runId,
              this.input.run.name,
              trialIndex,
              result.aggregate.pass,
              result.timings.durationMs,
            );
            await pushEvent(event);
            await notifyObservers(this.deps.observers, event);
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
      const workerCount = Math.min(this.input.execution.maxConcurrency, trialIndices.length);
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

      const summary = RunSummary.fromTrials(
        runId,
        this.input.task.id,
        this.input.run.name,
        completedTrials,
      );
      await this.deps.stores.saveRunSummary({ runId, summary: summary.toRecord() });

      manifest = manifest.complete();
      await this.deps.stores.saveRunManifest(manifest.toRecord());

      const completedEvent = new RunCompletedEvent(summary);
      yield completedEvent;
      await notifyObservers(this.deps.observers, completedEvent);
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

async function notifyObservers(observers: Observer[], event: RunEvent): Promise<void> {
  if (observers.length === 0) {
    return;
  }

  await Promise.all(observers.map((observer) => notifyObserverWithTimeout(observer, event)));
}

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
