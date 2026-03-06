import type { ObserverAdapter } from '../adapters/observer-adapter.js';
import type { ClearedResultEntry, ResultStoreAdapter } from '../adapters/result-store-adapter.js';
import type {
  ResolvedSuite,
  SuiteDescriptor,
  TaskIndex,
  TaskSourceAdapter,
} from '../adapters/task-source-adapter.js';
import type { RunManifest } from '../contracts/run-manifest.js';
import type { RunSummary, RunSummaryRecord } from '../contracts/run-summary.js';
import type {
  BaselineComparison,
  BaselineThresholds,
  GraderRegistry,
  ProviderRegistry,
  RunEvent,
  RuntimeDefaults,
} from '../contracts/runtime.js';
import type { SuiteDefinition } from '../contracts/suite.js';
import type { TrialResultRecord } from '../contracts/trial.js';
import { ERROR_CODES, RuntimeError, ValidationError } from '../errors/index.js';
import { orchestrateTaskRun } from '../orchestrator/run-orchestrator.js';
import { getEffectiveExecution } from '../runtime/effective-execution.js';
import { assertTaskExecutionReady } from '../runtime/task-execution.js';
import { ensureNonEmptyString } from '../validation/helpers.js';
import { normalizeRuntimeDefaults } from '../validation/runtime-defaults.js';
import { validateSuiteDefinition } from '../validation/suite-validator.js';
import {
  computeRegressionDiff,
  computeVerdict,
  validateBaselineThresholds,
  validateComparableDelta,
} from './baseline-utils.js';

export type LoadSuiteInput = string | SuiteDefinition | Promise<SuiteDefinition>;

export interface CoreDependencies {
  taskSourceAdapter: TaskSourceAdapter;
  resultStoreAdapter: ResultStoreAdapter;
  observerAdapters?: ObserverAdapter[];
  providerRegistry: ProviderRegistry;
  graderRegistry: GraderRegistry;
  runtimeDefaults?: RuntimeDefaults;
}

export interface LoadedSuite {
  readonly definition: SuiteDefinition;
  listTasks(): Promise<TaskIndex[]>;
  runTask(taskId: string): Promise<RunSummary[]>;
  streamTask(taskId: string, options?: { signal?: AbortSignal }): AsyncIterable<RunEvent>;
}

export interface CompareBaselineOptions {
  baselineRunId?: string;
  thresholds?: BaselineThresholds;
  tokenBudgetBreached?: boolean;
}

export interface CoreApi {
  listSuites(): Promise<SuiteDescriptor[]>;
  loadSuite(input: string): Promise<LoadedSuite>;
  loadSuite(input: SuiteDefinition): Promise<LoadedSuite>;
  loadSuite(input: Promise<SuiteDefinition>): Promise<LoadedSuite>;
  loadSuites(...inputs: LoadSuiteInput[]): Promise<LoadedSuite[]>;
  getRunManifest(runId: string): Promise<RunManifest | null>;
  getRunSummary(runId: string): Promise<RunSummary | null>;
  listTrials(runId: string): Promise<TrialResultRecord[]>;
  setBaseline(runId: string): Promise<void>;
  compareBaseline(
    currentRunId: string,
    options?: CompareBaselineOptions,
  ): Promise<BaselineComparison>;
  listRuns(): Promise<RunSummaryRecord[]>;
  clearResultsByRunIds(runIds: string[]): Promise<ClearedResultEntry[]>;
  clearResults(): Promise<ClearedResultEntry[]>;
}

async function resolveBaselineRunIdInput(
  baselineRunId: string | undefined,
  currentRunId: string,
  resultStore: ResultStoreAdapter,
): Promise<string> {
  if (baselineRunId !== undefined) {
    return Promise.resolve(ensureNonEmptyString(baselineRunId, 'baselineRunId'));
  }

  return resultStore.getBaselineRunId().then((resolvedBaselineRunId) => {
    if (resolvedBaselineRunId && resolvedBaselineRunId.trim().length > 0) {
      return resolvedBaselineRunId.trim();
    }

    throw new ValidationError('No baseline run is set in result store.', {
      details: {
        field: 'baselineRunId',
        currentRunId,
      },
    });
  });
}

export function createCore({
  taskSourceAdapter,
  resultStoreAdapter,
  observerAdapters = [],
  providerRegistry,
  graderRegistry,
  runtimeDefaults,
}: CoreDependencies): CoreApi {
  const orchDeps = {
    resultStoreAdapter,
    observerAdapters,
    providerRegistry,
    graderRegistry,
    runtimeDefaults: normalizeRuntimeDefaults(runtimeDefaults),
  };

  function buildLoadedSuite(
    definition: SuiteDefinition,
    preloadedResolvedSuite?: ResolvedSuite,
  ): LoadedSuite {
    let resolvedSuitePromise: Promise<ResolvedSuite> | undefined;

    async function resolveSuiteData(): Promise<ResolvedSuite> {
      if (preloadedResolvedSuite) {
        return preloadedResolvedSuite;
      }

      if (!resolvedSuitePromise) {
        resolvedSuitePromise = taskSourceAdapter.resolveSuite(definition.id);
      }

      return resolvedSuitePromise;
    }

    async function resolveTaskById(taskId: string) {
      const normalizedTaskId = ensureNonEmptyString(taskId, 'taskId');
      const resolvedSuite = await resolveSuiteData();
      const taskIndex = resolvedSuite.tasks.find((task) => task.id === normalizedTaskId);
      if (!taskIndex) {
        throw new ValidationError(
          `Task '${normalizedTaskId}' is not defined in suite '${definition.id}'.`,
          {
            details: {
              field: 'taskId',
              suiteId: definition.id,
              taskId: normalizedTaskId,
              knownTaskIds: resolvedSuite.tasks.map((task) => task.id),
            },
          },
        );
      }

      const resolvedTask = await taskSourceAdapter.resolveTask(taskIndex.taskRef);
      if (resolvedTask.task.id !== normalizedTaskId) {
        throw new RuntimeError(
          `Task source adapter resolved '${resolvedTask.task.id}' for requested task '${normalizedTaskId}'.`,
          {
            code: ERROR_CODES.RUNTIME_UNEXPECTED,
            details: {
              requestedTaskId: normalizedTaskId,
              resolvedTaskId: resolvedTask.task.id,
              suiteId: definition.id,
            },
          },
        );
      }

      return {
        resolvedTask,
        taskIndex,
      };
    }

    return {
      definition,

      async listTasks(): Promise<TaskIndex[]> {
        const resolvedSuite = await resolveSuiteData();
        return resolvedSuite.tasks;
      },

      async runTask(taskId: string): Promise<RunSummary[]> {
        const summaries: RunSummary[] = [];
        for await (const event of this.streamTask(taskId)) {
          if (event.type === 'run:completed') {
            summaries.push(event.summary);
          }
        }
        return summaries;
      },

      async *streamTask(
        taskId: string,
        options?: { signal?: AbortSignal },
      ): AsyncIterable<RunEvent> {
        const { resolvedTask } = await resolveTaskById(taskId);
        assertTaskExecutionReady(resolvedTask.task, orchDeps);
        const execution = getEffectiveExecution(resolvedTask.task, orchDeps.runtimeDefaults);

        for (const run of resolvedTask.task.provider.runs) {
          if (options?.signal?.aborted) {
            return;
          }

          yield* orchestrateTaskRun(
            {
              suite: definition,
              resolvedTask,
              run,
              execution,
              signal: options?.signal,
            },
            orchDeps,
          );
        }
      },
    };
  }

  async function loadSuiteInternal(input: string): Promise<LoadedSuite>;
  async function loadSuiteInternal(input: SuiteDefinition): Promise<LoadedSuite>;
  async function loadSuiteInternal(input: Promise<SuiteDefinition>): Promise<LoadedSuite>;
  async function loadSuiteInternal(input: LoadSuiteInput): Promise<LoadedSuite>;
  async function loadSuiteInternal(input: LoadSuiteInput): Promise<LoadedSuite> {
    if (typeof input === 'string') {
      const suiteId = ensureNonEmptyString(input, 'suiteId');
      const resolvedSuite = await taskSourceAdapter.resolveSuite(suiteId);
      return buildLoadedSuite(resolvedSuite.suite, resolvedSuite);
    }

    const raw = await input;
    const definition = validateSuiteDefinition(raw);
    return buildLoadedSuite(definition);
  }

  async function loadSuite(input: string): Promise<LoadedSuite>;
  async function loadSuite(input: SuiteDefinition): Promise<LoadedSuite>;
  async function loadSuite(input: Promise<SuiteDefinition>): Promise<LoadedSuite>;
  async function loadSuite(input: LoadSuiteInput): Promise<LoadedSuite>;
  async function loadSuite(input: LoadSuiteInput): Promise<LoadedSuite> {
    return loadSuiteInternal(input);
  }

  async function loadSuites(...inputs: LoadSuiteInput[]): Promise<LoadedSuite[]> {
    if (inputs.length === 0) {
      throw new ValidationError('At least one suite input is required.', {
        details: { field: 'inputs' },
      });
    }

    const loaded: LoadedSuite[] = [];
    for (const input of inputs) {
      loaded.push(await loadSuiteInternal(input));
    }
    return loaded;
  }

  return {
    async listSuites(): Promise<SuiteDescriptor[]> {
      return taskSourceAdapter.listSuites();
    },
    loadSuite,
    loadSuites,

    async getRunSummary(runId): Promise<RunSummary | null> {
      const normalizedRunId = ensureNonEmptyString(runId, 'runId');
      const record = await resultStoreAdapter.getRunSummary(normalizedRunId);
      return record?.summary ?? null;
    },

    async getRunManifest(runId): Promise<RunManifest | null> {
      const normalizedRunId = ensureNonEmptyString(runId, 'runId');
      return resultStoreAdapter.getRunManifest(normalizedRunId);
    },

    async listTrials(runId): Promise<TrialResultRecord[]> {
      const normalizedRunId = ensureNonEmptyString(runId, 'runId');
      return resultStoreAdapter.listTrials(normalizedRunId);
    },

    async setBaseline(runId): Promise<void> {
      const normalizedRunId = ensureNonEmptyString(runId, 'runId');
      const record = await resultStoreAdapter.getRunSummary(normalizedRunId);
      if (!record) {
        throw new ValidationError(`Run summary for '${normalizedRunId}' was not found.`, {
          details: { field: 'runId', runId: normalizedRunId },
        });
      }

      await resultStoreAdapter.saveBaseline({
        runId: normalizedRunId,
        updatedAt: new Date().toISOString(),
      });
    },

    async compareBaseline(
      currentRunId,
      options: CompareBaselineOptions = {},
    ): Promise<BaselineComparison> {
      const normalizedCurrentRunId = ensureNonEmptyString(currentRunId, 'currentRunId');
      validateBaselineThresholds(options.thresholds);

      const currentRecord = await resultStoreAdapter.getRunSummary(normalizedCurrentRunId);
      if (!currentRecord) {
        throw new ValidationError(`Run summary for '${normalizedCurrentRunId}' was not found.`, {
          details: { field: 'currentRunId', runId: normalizedCurrentRunId },
        });
      }
      const currentSummary = currentRecord.summary;

      const baselineRunId = await resolveBaselineRunIdInput(
        options.baselineRunId,
        normalizedCurrentRunId,
        resultStoreAdapter,
      );

      const baselineRecord = await resultStoreAdapter.getRunSummary(baselineRunId);
      if (!baselineRecord) {
        throw new ValidationError(`Run summary for '${baselineRunId}' was not found.`, {
          details: { field: 'baselineRunId', runId: baselineRunId },
        });
      }
      const baselineSummary = baselineRecord.summary;

      const passRateDelta = currentSummary.passRate - baselineSummary.passRate;
      const passHatKDelta =
        baselineSummary.passHatK !== undefined && currentSummary.passHatK !== undefined
          ? currentSummary.passHatK - baselineSummary.passHatK
          : undefined;
      const avgLatencyDelta =
        baselineSummary.avgLatencyMs !== undefined && currentSummary.avgLatencyMs !== undefined
          ? currentSummary.avgLatencyMs - baselineSummary.avgLatencyMs
          : undefined;

      validateComparableDelta(
        options.thresholds?.passHatKDrop,
        passHatKDelta,
        'runSummary.passHatK',
      );
      validateComparableDelta(
        options.thresholds?.avgLatencyIncrease,
        avgLatencyDelta,
        'runSummary.avgLatencyMs',
      );

      const baselineTrials = await resultStoreAdapter.listTrials(baselineRunId);
      const currentTrials = await resultStoreAdapter.listTrials(normalizedCurrentRunId);
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
    },

    async listRuns(): Promise<RunSummaryRecord[]> {
      const runIds = await resultStoreAdapter.listRunIds();
      const records: RunSummaryRecord[] = [];

      for (const runId of runIds) {
        const record = await resultStoreAdapter.getRunSummary(runId);
        if (record) {
          records.push(record);
        }
      }

      return records.sort((a, b) => a.runId.localeCompare(b.runId));
    },

    async clearResults(): Promise<ClearedResultEntry[]> {
      return resultStoreAdapter.clearAllResults();
    },

    async clearResultsByRunIds(runIds: string[]): Promise<ClearedResultEntry[]> {
      return resultStoreAdapter.clearResultsByRunIds(runIds);
    },
  };
}
