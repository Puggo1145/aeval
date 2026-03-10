import type { Observer } from '../adapters/observer-adapter.js';
import type { ClearedResultEntry, Stores } from '../adapters/result-store-adapter.js';
import type { SuiteDescriptor, TaskIndex, Tasks } from '../adapters/task-source-adapter.js';
import type { RunRecord } from '../contracts/run-record.js';
import type {
  BaselineComparison,
  BaselineThresholds,
  Graders,
  Providers,
  RuntimeDefaults,
} from '../contracts/runtime.js';
import type { SuiteDocument } from '../contracts/suite.js';
import { RunCompletedEvent, type RunEvent } from '../domain/run-event.js';
import { RunManifest } from '../domain/run-manifest.js';
import { RunSummary } from '../domain/run-summary.js';
import { Suite } from '../domain/suite.js';
import { Trial } from '../domain/trial.js';
import { ERROR_CODES, RuntimeError, ValidationError } from '../errors/index.js';
import { TaskRunOrchestrator } from '../orchestrator/run-orchestrator.js';
import { resolveExecutionPolicy, validateTaskRuntime } from '../runtime/task-execution.js';
import { ensureNonEmptyString } from '../validation/helpers.js';
import { normalizeRuntimeDefaults } from '../validation/runtime-defaults.js';
import {
  computeRegressionDiff,
  computeVerdict,
  validateBaselineThresholds,
  validateComparableDelta,
} from './baseline-utils.js';

export type LoadSuiteInput = string | SuiteDocument | Promise<SuiteDocument>;

export interface CompareBaselineOptions {
  baselineRunId?: string;
  thresholds?: BaselineThresholds;
  tokenBudgetBreached?: boolean;
}

export interface CoreDependencies {
  tasks: Tasks;
  stores: Stores;
  providers: Providers;
  graders: Graders;
  observers?: Observer[];
  runtimeDefaults?: RuntimeDefaults;
}

export type CoreApi = Core;

async function resolveBaselineRunIdInput(
  baselineRunId: string | undefined,
  currentRunId: string,
  stores: Stores,
): Promise<string> {
  if (baselineRunId !== undefined) {
    return Promise.resolve(ensureNonEmptyString(baselineRunId, 'baselineRunId'));
  }

  const resolvedBaselineRunId = await stores.getBaselineRunId();
  if (resolvedBaselineRunId && resolvedBaselineRunId.trim().length > 0) {
    return resolvedBaselineRunId.trim();
  }

  throw new ValidationError('No baseline run is set in result store.', {
    details: {
      field: 'baselineRunId',
      currentRunId,
    },
  });
}

export class Core {
  readonly tasks: Tasks;
  readonly stores: Stores;
  readonly providers: Providers;
  readonly graders: Graders;
  readonly observers: readonly Observer[];
  readonly runtimeDefaults: Required<RuntimeDefaults>;

  constructor(input: CoreDependencies) {
    this.tasks = input.tasks;
    this.stores = input.stores;
    this.providers = input.providers;
    this.graders = input.graders;
    this.observers = Object.freeze([...(input.observers ?? [])]);
    this.runtimeDefaults = normalizeRuntimeDefaults(input.runtimeDefaults);
  }

  async listSuites(): Promise<SuiteDescriptor[]> {
    return this.tasks.listSuites();
  }

  async loadSuite(input: LoadSuiteInput): Promise<Suite> {
    if (typeof input === 'string') {
      const suiteId = ensureNonEmptyString(input, 'suiteId');
      const suite = await this.tasks.resolveSuite(suiteId);
      return this.bindSuite(suite);
    }

    const raw = await input;
    return this.bindSuite(Suite.fromDocument(raw, { tasks: this.tasks }), false);
  }

  async loadSuites(...inputs: LoadSuiteInput[]): Promise<Suite[]> {
    if (inputs.length === 0) {
      throw new ValidationError('At least one suite input is required.', {
        details: { field: 'inputs' },
      });
    }

    const suites: Suite[] = [];
    for (const input of inputs) {
      suites.push(await this.loadSuite(input));
    }
    return suites;
  }

  async getRunManifest(runId: string): Promise<RunManifest | null> {
    const normalizedRunId = ensureNonEmptyString(runId, 'runId');
    const record = await this.stores.getRunManifest(normalizedRunId);
    return record ? RunManifest.fromRecord(record) : null;
  }

  async getRunSummary(runId: string): Promise<RunSummary | null> {
    const normalizedRunId = ensureNonEmptyString(runId, 'runId');
    const record = await this.stores.getRunSummary(normalizedRunId);
    return record ? RunSummary.fromRecord(record.summary) : null;
  }

  async listTrials(runId: string): Promise<Trial[]> {
    const normalizedRunId = ensureNonEmptyString(runId, 'runId');
    const records = await this.stores.listTrials(normalizedRunId);
    return records.map((record) => Trial.fromRecord(record.trial));
  }

  async setBaseline(runId: string): Promise<void> {
    const normalizedRunId = ensureNonEmptyString(runId, 'runId');
    const record = await this.stores.getRunSummary(normalizedRunId);
    if (!record) {
      throw new ValidationError(`Run summary for '${normalizedRunId}' was not found.`, {
        details: { field: 'runId', runId: normalizedRunId },
      });
    }

    await this.stores.saveBaseline({
      runId: normalizedRunId,
      updatedAt: new Date().toISOString(),
    });
  }

  async compareBaseline(
    currentRunId: string,
    options: CompareBaselineOptions = {},
  ): Promise<BaselineComparison> {
    const normalizedCurrentRunId = ensureNonEmptyString(currentRunId, 'currentRunId');
    validateBaselineThresholds(options.thresholds);

    const currentRecord = await this.stores.getRunSummary(normalizedCurrentRunId);
    if (!currentRecord) {
      throw new ValidationError(`Run summary for '${normalizedCurrentRunId}' was not found.`, {
        details: { field: 'currentRunId', runId: normalizedCurrentRunId },
      });
    }
    const currentSummary = RunSummary.fromRecord(currentRecord.summary);

    const baselineRunId = await resolveBaselineRunIdInput(
      options.baselineRunId,
      normalizedCurrentRunId,
      this.stores,
    );

    const baselineRecord = await this.stores.getRunSummary(baselineRunId);
    if (!baselineRecord) {
      throw new ValidationError(`Run summary for '${baselineRunId}' was not found.`, {
        details: { field: 'baselineRunId', runId: baselineRunId },
      });
    }
    const baselineSummary = RunSummary.fromRecord(baselineRecord.summary);

    const passRateDelta = currentSummary.passRate - baselineSummary.passRate;
    const passHatKDelta =
      baselineSummary.passHatK !== undefined && currentSummary.passHatK !== undefined
        ? currentSummary.passHatK - baselineSummary.passHatK
        : undefined;
    const avgLatencyDelta =
      baselineSummary.avgLatencyMs !== undefined && currentSummary.avgLatencyMs !== undefined
        ? currentSummary.avgLatencyMs - baselineSummary.avgLatencyMs
        : undefined;

    validateComparableDelta(options.thresholds?.passHatKDrop, passHatKDelta, 'runSummary.passHatK');
    validateComparableDelta(
      options.thresholds?.avgLatencyIncrease,
      avgLatencyDelta,
      'runSummary.avgLatencyMs',
    );

    const baselineTrials = (await this.stores.listTrials(baselineRunId)).map((record) =>
      Trial.fromRecord(record.trial),
    );
    const currentTrials = (await this.stores.listTrials(normalizedCurrentRunId)).map((record) =>
      Trial.fromRecord(record.trial),
    );
    const { regressions, improvements } = computeRegressionDiff(baselineTrials, currentTrials);

    const comparison: BaselineComparison = {
      baselineRunId,
      currentRunId: normalizedCurrentRunId,
      passRateDelta,
      regressions,
      improvements,
      verdict: 'pass',
    };

    if (passHatKDelta !== undefined) {
      comparison.passHatKDelta = passHatKDelta;
    }
    if (avgLatencyDelta !== undefined) {
      comparison.avgLatencyDelta = avgLatencyDelta;
    }
    if (options.tokenBudgetBreached !== undefined) {
      comparison.tokenBudgetBreached = options.tokenBudgetBreached;
    }

    comparison.verdict = computeVerdict(
      {
        passRateDelta: comparison.passRateDelta,
        passHatKDelta: comparison.passHatKDelta,
        avgLatencyDelta: comparison.avgLatencyDelta,
        tokenBudgetBreached: comparison.tokenBudgetBreached,
        improvements: comparison.improvements,
      },
      options.thresholds,
    );

    return comparison;
  }

  async listRuns(): Promise<RunRecord[]> {
    const runIds = await this.stores.listRunIds();
    const records: RunRecord[] = [];

    for (const runId of runIds) {
      const [manifestRecord, summaryRecord] = await Promise.all([
        this.stores.getRunManifest(runId),
        this.stores.getRunSummary(runId),
      ]);

      records.push({
        runId,
        status: summaryRecord ? 'completed' : 'interrupted',
        manifest: manifestRecord ? RunManifest.fromRecord(manifestRecord) : null,
        summary: summaryRecord ? RunSummary.fromRecord(summaryRecord.summary) : null,
      });
    }

    return records.sort((a, b) => a.runId.localeCompare(b.runId));
  }

  async clearResults(): Promise<ClearedResultEntry[]> {
    return this.stores.clearAllResults();
  }

  async clearResultsByRunIds(runIds: string[]): Promise<ClearedResultEntry[]> {
    return this.stores.clearResultsByRunIds(runIds);
  }

  private bindSuite(suite: Suite, preloaded = true): Suite {
    const suiteCore = this;
    let suitePromise: Promise<Suite> | undefined = preloaded ? Promise.resolve(suite) : undefined;

    const resolveSuiteData = async (): Promise<Suite> => {
      if (!suitePromise) {
        suitePromise = this.tasks.resolveSuite(suite.id);
      }

      return suitePromise;
    };

    const resolveTaskById = async (taskId: string) => {
      const normalizedTaskId = ensureNonEmptyString(taskId, 'taskId');
      const resolvedSuite = await resolveSuiteData();
      const taskIndexes = await resolvedSuite.listTasks();
      const taskIndex = taskIndexes.find((task) => task.id === normalizedTaskId);
      if (!taskIndex) {
        throw new ValidationError(
          `Task '${normalizedTaskId}' is not defined in suite '${suite.id}'.`,
          {
            details: {
              field: 'taskId',
              suiteId: suite.id,
              taskId: normalizedTaskId,
              knownTaskIds: taskIndexes.map((task) => task.id),
            },
          },
        );
      }

      const task = await this.tasks.resolveTask(taskIndex.taskRef);
      if (task.id !== normalizedTaskId) {
        throw new RuntimeError(
          `Task source resolved '${task.id}' for requested task '${normalizedTaskId}'.`,
          {
            code: ERROR_CODES.RUNTIME_UNEXPECTED,
            details: {
              requestedTaskId: normalizedTaskId,
              resolvedTaskId: task.id,
              suiteId: suite.id,
            },
          },
        );
      }

      return task;
    };

    let suiteWithActions: Suite;

    suiteWithActions = suite.withActions(
      {
        listTasks: async (): Promise<TaskIndex[]> => {
          const resolvedSuite = await resolveSuiteData();
          return resolvedSuite.listTasks();
        },

        runTask: async (taskId: string): Promise<RunSummary[]> => {
          const summaries: RunSummary[] = [];
          for await (const event of suiteWithActions.streamTask(taskId)) {
            if (event instanceof RunCompletedEvent) {
              summaries.push(event.summary);
            }
          }
          return summaries;
        },

        streamTask: async function* (
          taskId: string,
          options?: { signal?: AbortSignal },
        ): AsyncIterable<RunEvent> {
          const task = await resolveTaskById(taskId);
          validateTaskRuntime(task, {
            providers: suiteCore.providers,
            graders: suiteCore.graders,
          });
          const execution = resolveExecutionPolicy(task, suiteCore.runtimeDefaults);

          for (const run of task.runs) {
            if (options?.signal?.aborted) {
              return;
            }

            yield* new TaskRunOrchestrator(
              {
                suite,
                task,
                run,
                execution,
                signal: options?.signal,
              },
              {
                stores: suiteCore.stores,
                observers: [...suiteCore.observers],
                providers: suiteCore.providers,
                graders: suiteCore.graders,
              },
            ).run();
          }
        },
      },
      this.tasks,
    );

    return suiteWithActions;
  }
}
