import type { ObserverAdapter } from '../adapters/observer-adapter.js';
import type { ClearedResultEntry, ResultStoreAdapter } from '../adapters/result-store-adapter.js';
import type { TaskSourceAdapter } from '../adapters/task-source-adapter.js';
import type { ExperimentDefinition } from '../contracts/experiment.js';
import type { RunManifest } from '../contracts/run-manifest.js';
import type { RunSummary, RunSummaryRecord } from '../contracts/run-summary.js';
import type {
  BaselineComparison,
  BaselineThresholds,
  GraderRegistry,
  ProviderRegistry,
  RunEvent,
} from '../contracts/runtime.js';
import type { TrialResultRecord } from '../contracts/trial.js';
import { ERROR_CODES, RuntimeError, ValidationError } from '../errors/index.js';
import { orchestrateRun } from '../orchestrator/run-orchestrator.js';
import { validateExperimentDefinition } from '../validation/experiment-validator.js';
import { ensureNonEmptyString } from '../validation/helpers.js';
import {
  computeRegressionDiff,
  computeVerdict,
  validateBaselineThresholds,
  validateComparableDelta,
} from './baseline-utils.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CoreDependencies {
  taskSourceAdapter: TaskSourceAdapter;
  resultStoreAdapter: ResultStoreAdapter;
  observerAdapters?: ObserverAdapter[];
  providerRegistry: ProviderRegistry;
  graderRegistry: GraderRegistry;
}

export interface LoadedExperiment {
  readonly definition: ExperimentDefinition;
  run(runName: string): Promise<RunSummary>;
  stream(runName: string): AsyncIterable<RunEvent>;
}

export interface CompareBaselineOptions {
  baselineRunId?: string;
  thresholds?: BaselineThresholds;
  tokenBudgetBreached?: boolean;
}

export interface CoreApi {
  readonly experiments: readonly LoadedExperiment[];
  loadExperiment(input: unknown | Promise<unknown>): Promise<LoadedExperiment>;
  loadExperiments(...inputs: Array<unknown | Promise<unknown>>): Promise<LoadedExperiment[]>;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureRunExists(runName: string, experiment: ExperimentDefinition): void {
  const hasMatchingRun = experiment.runs.some((run) => run.name === runName);
  if (hasMatchingRun) {
    return;
  }

  throw new ValidationError(`Run '${runName}' is not defined in 'experiment.runs'.`, {
    details: {
      field: 'runName',
      runName,
      knownRuns: experiment.runs.map((run) => run.name),
    },
  });
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCore(deps: CoreDependencies): CoreApi {
  const {
    taskSourceAdapter,
    resultStoreAdapter,
    observerAdapters = [],
    providerRegistry,
    graderRegistry,
  } = deps;

  function buildLoadedExperiment(definition: ExperimentDefinition): LoadedExperiment {
    const orchDeps = {
      taskSourceAdapter,
      resultStoreAdapter,
      observerAdapters,
      providerRegistry,
      graderRegistry,
    };

    return {
      definition,

      async run(runName: string): Promise<RunSummary> {
        const normalizedRunName = ensureNonEmptyString(runName, 'runName');
        ensureRunExists(normalizedRunName, definition);

        let summary: RunSummary | undefined;
        for await (const event of orchestrateRun(
          { experiment: definition, runName: normalizedRunName },
          orchDeps,
        )) {
          if (event.type === 'run:completed') {
            summary = event.summary;
          }
        }

        if (!summary) {
          throw new RuntimeError('Run completed without producing a summary.', {
            code: ERROR_CODES.RUNTIME_UNEXPECTED,
            details: { runName: normalizedRunName },
          });
        }

        return summary;
      },

      stream(runName: string): AsyncIterable<RunEvent> {
        const normalizedRunName = ensureNonEmptyString(runName, 'runName');
        ensureRunExists(normalizedRunName, definition);

        return orchestrateRun({ experiment: definition, runName: normalizedRunName }, orchDeps);
      },
    };
  }

  const loadedExperiments: LoadedExperiment[] = [];

  async function loadExperimentInternal(input: unknown | Promise<unknown>): Promise<LoadedExperiment> {
    const raw = await input;
    const definition = validateExperimentDefinition(raw);
    const loaded = buildLoadedExperiment(definition);
    loadedExperiments.push(loaded);
    return loaded;
  }

  return {
    get experiments(): readonly LoadedExperiment[] {
      return loadedExperiments;
    },

    async loadExperiment(input): Promise<LoadedExperiment> {
      return loadExperimentInternal(input);
    },

    async loadExperiments(...inputs): Promise<LoadedExperiment[]> {
      if (inputs.length === 0) {
        throw new ValidationError('At least one experiment input is required.', {
          details: { field: 'inputs' },
        });
      }

      const loaded: LoadedExperiment[] = [];
      for (const input of inputs) {
        loaded.push(await loadExperimentInternal(input));
      }
      return loaded;
    },

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
