import type { ResultStoreAdapter } from '../adapters/result-store-adapter.js';
import type { ExperimentDefinition } from '../contracts/experiment.js';
import type { RunSummary, RunSummaryRecord } from '../contracts/run-summary.js';
import type { BaselineComparison, BaselineThresholds, RunEvent } from '../contracts/runtime.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import type { TrialResultRecord } from '../contracts/trial.js';
import { ERROR_CODES, RuntimeError, ValidationError } from '../errors/index.js';
import { orchestrateRun } from '../orchestrator/run-orchestrator.js';
import {
  type RuntimeDependencyContainer,
  resolveRuntimeDependencies,
} from '../runtime/dependency-resolver.js';
import { ensureNonEmptyString } from '../validation/helpers.js';
import {
  computeRegressionDiff,
  computeVerdict,
  validateBaselineThresholds,
  validateComparableDelta,
} from './baseline-utils.js';

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

interface ResolvedRunStore {
  adapterId: string;
  resultStore: ResultStoreAdapter;
  summary: RunSummary;
}

async function collectMatchedRunStores(
  runId: string,
  resultStoreAdapters: Readonly<Record<string, ResultStoreAdapter>>,
): Promise<ResolvedRunStore[]> {
  const entries = Object.entries(resultStoreAdapters);
  if (entries.length === 0) {
    return [];
  }

  const matches = await Promise.all(
    entries.map(async ([adapterId, resultStore]) => {
      const record = await resultStore.getRunSummary(runId);
      if (!record) {
        return null;
      }

      return {
        adapterId,
        resultStore,
        summary: record.summary,
      } satisfies ResolvedRunStore;
    }),
  );

  return matches.filter((match): match is ResolvedRunStore => match !== null);
}

async function resolveRunStoreOrNull(
  runId: string,
  dependencies: RuntimeDependencyContainer,
): Promise<ResolvedRunStore | null> {
  const matches = await collectMatchedRunStores(runId, dependencies.resultStoreAdapters);
  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0] ?? null;
  }

  throw new RuntimeError(
    `Run '${runId}' was found in multiple result stores and cannot be resolved unambiguously.`,
    {
      code: ERROR_CODES.RUNTIME_DEPENDENCY_AMBIGUOUS,
      details: {
        runId,
        matchedAdapters: matches.map((match) => match.adapterId).sort(),
      },
    },
  );
}

async function resolveRunStoreOrThrow(
  runId: string,
  dependencies: RuntimeDependencyContainer,
  field: string,
): Promise<ResolvedRunStore> {
  const resolved = await resolveRunStoreOrNull(runId, dependencies);
  if (resolved) {
    return resolved;
  }

  throw new ValidationError(`Run summary for '${runId}' was not found.`, {
    details: {
      field,
      runId,
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

export interface RunExperimentInput {
  experiment: ExperimentDefinition;
  runName: string;
}

export interface CompareBaselineOptions {
  baselineRunId?: string;
  thresholds?: BaselineThresholds;
  tokenBudgetBreached?: boolean;
}

export interface CoreApi {
  runExperiment(input: RunExperimentInput): Promise<RunSummary>;
  streamRun(input: RunExperimentInput): AsyncIterable<RunEvent>;
  getRunSummary(runId: string): Promise<RunSummary | null>;
  listTrials(runId: string): Promise<TrialResultRecord[]>;
  setBaseline(runId: string): Promise<void>;
  compareBaseline(
    currentRunId: string,
    options?: CompareBaselineOptions,
  ): Promise<BaselineComparison>;
  listRuns(): Promise<RunSummaryRecord[]>;
}

export function createCore(dependencies: RuntimeDependencyContainer): CoreApi {
  return {
    async runExperiment(input): Promise<RunSummary> {
      const runName = ensureNonEmptyString(input.runName, 'runName');
      ensureRunExists(runName, input.experiment);

      const resolved = resolveRuntimeDependencies(input.experiment, dependencies);

      let summary: RunSummary | undefined;
      for await (const event of orchestrateRun(
        { experiment: input.experiment, runName },
        resolved,
      )) {
        if (event.type === 'run:completed') {
          summary = event.summary;
        }
      }

      if (!summary) {
        throw new RuntimeError('Run completed without producing a summary.', {
          code: ERROR_CODES.RUNTIME_UNEXPECTED,
          details: { runName },
        });
      }

      return summary;
    },

    streamRun(input): AsyncIterable<RunEvent> {
      const runName = ensureNonEmptyString(input.runName, 'runName');
      ensureRunExists(runName, input.experiment);

      const resolved = resolveRuntimeDependencies(input.experiment, dependencies);

      return orchestrateRun({ experiment: input.experiment, runName }, resolved);
    },

    async getRunSummary(runId): Promise<RunSummary | null> {
      const normalizedRunId = ensureNonEmptyString(runId, 'runId');
      const resolved = await resolveRunStoreOrNull(normalizedRunId, dependencies);
      return resolved?.summary ?? null;
    },

    async listTrials(runId): Promise<TrialResultRecord[]> {
      const normalizedRunId = ensureNonEmptyString(runId, 'runId');
      const resolved = await resolveRunStoreOrNull(normalizedRunId, dependencies);
      if (!resolved) {
        return [];
      }

      return resolved.resultStore.listTrials(normalizedRunId);
    },

    async setBaseline(runId): Promise<void> {
      const normalizedRunId = ensureNonEmptyString(runId, 'runId');
      const resolved = await resolveRunStoreOrThrow(normalizedRunId, dependencies, 'runId');

      await resolved.resultStore.saveBaseline({
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

      const currentStore = await resolveRunStoreOrThrow(
        normalizedCurrentRunId,
        dependencies,
        'currentRunId',
      );

      const baselineRunId = await resolveBaselineRunIdInput(
        options.baselineRunId,
        normalizedCurrentRunId,
        currentStore.resultStore,
      );

      const baselineStore = options.baselineRunId
        ? await resolveRunStoreOrThrow(baselineRunId, dependencies, 'baselineRunId')
        : (() => {
            return currentStore;
          })();

      const baselineSummary = options.baselineRunId
        ? baselineStore.summary
        : await currentStore.resultStore.getRunSummary(baselineRunId).then((record) => {
            if (record) {
              return record.summary;
            }

            throw new ValidationError(`Run summary for '${baselineRunId}' was not found.`, {
              details: {
                field: 'baselineRunId',
                runId: baselineRunId,
              },
            });
          });

      const currentSummary = currentStore.summary;

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

      const baselineTrials = await baselineStore.resultStore.listTrials(baselineRunId);
      const currentTrials = await currentStore.resultStore.listTrials(normalizedCurrentRunId);
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
      const entries = Object.entries(dependencies.resultStoreAdapters);
      const allRecords = new Map<string, RunSummaryRecord>();
      const runIdToAdapter = new Map<string, string>();

      for (const [adapterId, resultStore] of entries) {
        const runIds = await resultStore.listRunIds();
        for (const runId of runIds) {
          const existingAdapter = runIdToAdapter.get(runId);
          if (existingAdapter && existingAdapter !== adapterId) {
            throw new RuntimeError(
              `Run '${runId}' was found in multiple result stores and cannot be resolved unambiguously.`,
              {
                code: ERROR_CODES.RUNTIME_DEPENDENCY_AMBIGUOUS,
                details: {
                  field: 'runId',
                  runId,
                  matchedAdapters: [existingAdapter, adapterId].sort(),
                },
              },
            );
          }

          const record = await resultStore.getRunSummary(runId);
          if (record) {
            runIdToAdapter.set(runId, adapterId);
            allRecords.set(runId, record);
          }
        }
      }

      return [...allRecords.values()].sort((a, b) => a.runId.localeCompare(b.runId));
    },
  };
}

export function createEmptyRunSummary(runId: string, runName: string): RunSummary {
  return {
    schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
    runId,
    runName,
    totalTasks: 0,
    totalTrials: 0,
    passRate: 0,
  };
}
