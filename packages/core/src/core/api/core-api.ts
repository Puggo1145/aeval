import type { Observer } from '../adapters/observer-adapter.js';
import type { ClearedResultEntry, Stores } from '../adapters/result-store-adapter.js';
import type {
  ResolvedSuite,
  ResolvedTask,
  SuiteDescriptor,
  SuiteInput,
  TaskIndex,
  TaskRef,
  Tasks,
} from '../adapters/task-source-adapter.js';
import type { RunManifestRecord } from '../contracts/run-manifest.js';
import type { RunRecord } from '../contracts/run-record.js';
import type { RunSummaryData } from '../contracts/run-summary.js';
import type {
  BaselineComparison,
  BaselineThresholds,
  Graders,
  Providers,
  RunEvent,
  RuntimeDefaults,
} from '../contracts/runtime.js';
import type { SuiteDocument } from '../contracts/suite.js';
import type { TrialRecord } from '../contracts/trial.js';
import { RunSummary } from '../domain/run-summary.js';
import { Suite } from '../domain/suite.js';
import { Task } from '../domain/task.js';
import { ERROR_CODES, RuntimeError, ValidationError } from '../errors/index.js';
import { TaskRunOrchestrator } from '../orchestrator/run-orchestrator.js';
import { resolveExecutionPolicy, validateTaskRuntime } from '../runtime/task-execution.js';
import { ensureNonEmptyString } from '../validation/helpers.js';
import { normalizeRuntimeDefaults } from '../validation/runtime-defaults.js';
import {
  computeVerdict,
  validateBaselineThresholds,
  validateComparableDelta,
} from './baseline-utils.js';

export type LoadSuiteInput = string | SuiteInput | Promise<SuiteInput>;

export interface CompareBaselineOptions {
  baselineRunId: string;
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

export interface CoreSuitesApi {
  list(): Promise<SuiteDescriptor[]>;
  load(input: LoadSuiteInput): Promise<LoadedSuite>;
  loadMany(...inputs: LoadSuiteInput[]): Promise<LoadedSuite[]>;
}

export interface CoreResultsApi {
  list(): Promise<RunRecord[]>;
  getManifest(runId: string): Promise<RunManifestRecord | null>;
  getSummary(runId: string): Promise<RunSummaryData | null>;
  listTrials(runId: string): Promise<TrialRecord[]>;
  clearAll(): Promise<ClearedResultEntry[]>;
  clearByRunIds(runIds: string[]): Promise<ClearedResultEntry[]>;
}

export interface CoreBaselineApi {
  compare(currentRunId: string, options: CompareBaselineOptions): Promise<BaselineComparison>;
}

export interface CoreApi {
  readonly suites: CoreSuitesApi;
  readonly results: CoreResultsApi;
  readonly baseline: CoreBaselineApi;
}

export interface LoadedSuiteInit {
  getSuite(): Suite;
  listTasks(): Promise<TaskIndex[]>;
  runTask(taskId: string): Promise<RunSummaryData[]>;
  streamTask(taskId: string, options?: { signal?: AbortSignal }): AsyncIterable<RunEvent>;
}

export class LoadedSuite {
  constructor(private readonly input: LoadedSuiteInit) {}

  get schemaVersion(): Suite['schemaVersion'] {
    return this.input.getSuite().schemaVersion;
  }

  get id(): string {
    return this.input.getSuite().id;
  }

  get name(): string {
    return this.input.getSuite().name;
  }

  get discover(): readonly string[] {
    return this.input.getSuite().discover;
  }

  get source(): Suite['source'] {
    return this.input.getSuite().source;
  }

  get taskIndexes(): readonly TaskIndex[] | undefined {
    return this.input.getSuite().taskIndexes;
  }

  get definition(): SuiteDocument {
    return this.input.getSuite().definition;
  }

  async listTasks(): Promise<TaskIndex[]> {
    return this.input.listTasks();
  }

  async runTask(taskId: string): Promise<RunSummaryData[]> {
    return this.input.runTask(taskId);
  }

  streamTask(taskId: string, options?: { signal?: AbortSignal }): AsyncIterable<RunEvent> {
    return this.input.streamTask(taskId, options);
  }
}

function taskIndexFromDomainTask(task: Task, taskRef: TaskRef): TaskIndex {
  return {
    id: task.id,
    ...(task.desc !== undefined ? { desc: task.desc } : {}),
    ...(task.category !== undefined ? { category: task.category } : {}),
    ...(task.capability !== undefined ? { capability: task.capability } : {}),
    ...(task.tier !== undefined ? { tier: task.tier } : {}),
    ...(task.difficulty !== undefined ? { difficulty: task.difficulty } : {}),
    ...(task.tags !== undefined ? { tags: [...task.tags] } : {}),
    runCount: task.runs.length,
    taskRef,
  };
}

function validateBaselineTaskMatch(input: {
  currentRunId: string;
  currentTaskId: string;
  baselineRunId: string;
  baselineTaskId: string;
}): string {
  if (input.currentTaskId === input.baselineTaskId) {
    return input.currentTaskId;
  }

  throw new ValidationError(
    `Baseline compare requires runs from the same task. Current run '${input.currentRunId}' belongs to '${input.currentTaskId}' while baseline run '${input.baselineRunId}' belongs to '${input.baselineTaskId}'.`,
    {
      details: {
        field: 'taskId',
        currentRunId: input.currentRunId,
        currentTaskId: input.currentTaskId,
        baselineRunId: input.baselineRunId,
        baselineTaskId: input.baselineTaskId,
      },
    },
  );
}

export class Core implements CoreApi {
  readonly tasks: Tasks;
  readonly stores: Stores;
  readonly providers: Providers;
  readonly graders: Graders;
  readonly observers: readonly Observer[];
  readonly runtimeDefaults: Required<RuntimeDefaults>;
  readonly suites: CoreSuitesApi;
  readonly results: CoreResultsApi;
  readonly baseline: CoreBaselineApi;

  constructor(input: CoreDependencies) {
    this.tasks = input.tasks;
    this.stores = input.stores;
    this.providers = input.providers;
    this.graders = input.graders;
    this.observers = Object.freeze([...(input.observers ?? [])]);
    this.runtimeDefaults = normalizeRuntimeDefaults(input.runtimeDefaults);
    this.suites = Object.freeze({
      list: () => this.listSuitesFromTasks(),
      load: (suite: LoadSuiteInput) => this.loadSuiteHandle(suite),
      loadMany: (...inputs: LoadSuiteInput[]) => this.loadSuiteHandles(...inputs),
    });
    this.results = Object.freeze({
      list: () => this.listRunRecords(),
      getManifest: (runId: string) => this.getRunManifestRecord(runId),
      getSummary: (runId: string) => this.getRunSummaryData(runId),
      listTrials: (runId: string) => this.listTrialRecords(runId),
      clearAll: () => this.clearAllRunResults(),
      clearByRunIds: (runIds: string[]) => this.clearRunResultsById(runIds),
    });
    this.baseline = Object.freeze({
      compare: (currentRunId: string, options: CompareBaselineOptions) =>
        this.compareAgainstBaseline(currentRunId, options),
    });
  }

  private async listSuitesFromTasks(): Promise<SuiteDescriptor[]> {
    return this.tasks.listSuites();
  }

  private async loadSuiteHandle(input: LoadSuiteInput): Promise<LoadedSuite> {
    if (typeof input === 'string') {
      const suiteId = ensureNonEmptyString(input, 'suiteId');
      const resolvedSuite = await this.tasks.resolveSuite(suiteId);
      const suite = toInternalSuite(resolvedSuite);
      return this.bindSuite(suite, resolvedSuite);
    }

    const raw = await input;
    return this.bindSuite(Suite.fromDocument(raw));
  }

  private async loadSuiteHandles(...inputs: LoadSuiteInput[]): Promise<LoadedSuite[]> {
    if (inputs.length === 0) {
      throw new ValidationError('At least one suite input is required.', {
        details: { field: 'inputs' },
      });
    }

    const suites: LoadedSuite[] = [];
    for (const input of inputs) {
      suites.push(await this.loadSuiteHandle(input));
    }
    return suites;
  }

  private async getRunManifestRecord(runId: string): Promise<RunManifestRecord | null> {
    const normalizedRunId = ensureNonEmptyString(runId, 'runId');
    return this.stores.getRunManifest(normalizedRunId);
  }

  private async getRunSummaryData(runId: string): Promise<RunSummaryData | null> {
    const normalizedRunId = ensureNonEmptyString(runId, 'runId');
    const record = await this.stores.getRunSummary(normalizedRunId);
    return record?.summary ?? null;
  }

  private async listTrialRecords(runId: string): Promise<TrialRecord[]> {
    const normalizedRunId = ensureNonEmptyString(runId, 'runId');
    const records = await this.stores.listTrials(normalizedRunId);
    return records.map((record) => record.trial);
  }

  private async compareAgainstBaseline(
    currentRunId: string,
    options: CompareBaselineOptions,
  ): Promise<BaselineComparison> {
    const normalizedCurrentRunId = ensureNonEmptyString(currentRunId, 'currentRunId');
    if (typeof options !== 'object' || options === null) {
      throw new ValidationError("Field 'options' must be an object.", {
        details: {
          field: 'options',
          currentRunId: normalizedCurrentRunId,
        },
      });
    }
    const baselineRunId = ensureNonEmptyString(options.baselineRunId, 'baselineRunId');
    validateBaselineThresholds(options.thresholds);

    const currentRecord = await this.stores.getRunSummary(normalizedCurrentRunId);
    if (!currentRecord) {
      throw new ValidationError(`Run summary for '${normalizedCurrentRunId}' was not found.`, {
        details: { field: 'currentRunId', runId: normalizedCurrentRunId },
      });
    }
    const currentSummary = RunSummary.fromRecord(currentRecord.summary);

    const baselineRecord = await this.stores.getRunSummary(baselineRunId);
    if (!baselineRecord) {
      throw new ValidationError(`Run summary for '${baselineRunId}' was not found.`, {
        details: { field: 'baselineRunId', runId: baselineRunId },
      });
    }
    const baselineSummary = RunSummary.fromRecord(baselineRecord.summary);
    const taskId = validateBaselineTaskMatch({
      currentRunId: normalizedCurrentRunId,
      currentTaskId: currentSummary.taskId,
      baselineRunId,
      baselineTaskId: baselineSummary.taskId,
    });

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

    const comparison: BaselineComparison = {
      taskId,
      baselineRunId,
      currentRunId: normalizedCurrentRunId,
      passRateDelta,
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
      },
      options.thresholds,
    );

    return comparison;
  }

  private async listRunRecords(): Promise<RunRecord[]> {
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
        manifest: manifestRecord,
        summary: summaryRecord?.summary ?? null,
      });
    }

    return records;
  }

  private async clearAllRunResults(): Promise<ClearedResultEntry[]> {
    return this.stores.clearAllResults();
  }

  private async clearRunResultsById(runIds: string[]): Promise<ClearedResultEntry[]> {
    return this.stores.clearResultsByRunIds(runIds);
  }

  private bindSuite(suite: Suite, preloadedResolvedSuite?: ResolvedSuite): LoadedSuite {
    const suiteCore = this;
    let currentSuite = suite;
    let resolvedSuitePromise: Promise<ResolvedSuite> | undefined;
    let taskIndexesPromise: Promise<TaskIndex[]> | undefined;

    if (preloadedResolvedSuite) {
      resolvedSuitePromise = Promise.resolve(preloadedResolvedSuite);
    }

    const resolveSuiteData = async (): Promise<ResolvedSuite> => {
      if (!resolvedSuitePromise) {
        resolvedSuitePromise = this.tasks.resolveSuite(suite.id);
      }

      const resolved = await resolvedSuitePromise;
      currentSuite = mergeSuiteMetadata(currentSuite, toInternalSuite(resolved));
      return resolved;
    };

    const resolveTaskIndexes = async (): Promise<TaskIndex[]> => {
      if (!taskIndexesPromise) {
        taskIndexesPromise = resolveSuiteData().then(async (resolved) => {
          const taskIndexes: TaskIndex[] = [];
          const seenTaskIds = new Set<string>();

          for (const taskRef of resolved.taskRefs) {
            const task = toInternalTask(await this.tasks.resolveTask(taskRef));
            if (seenTaskIds.has(task.id)) {
              throw new RuntimeError(
                `Task id '${task.id}' must be unique within suite '${suite.id}'.`,
                {
                  code: ERROR_CODES.RUNTIME_UNEXPECTED,
                  details: {
                    suiteId: suite.id,
                    taskId: task.id,
                    taskRef: taskRef.ref,
                  },
                },
              );
            }

            seenTaskIds.add(task.id);
            taskIndexes.push(taskIndexFromDomainTask(task, taskRef));
          }

          currentSuite = mergeSuiteMetadata(currentSuite, currentSuite, taskIndexes);
          return taskIndexes;
        });
      }

      return taskIndexesPromise;
    };

    const resolveTaskById = async (taskId: string): Promise<Task> => {
      const normalizedTaskId = ensureNonEmptyString(taskId, 'taskId');
      await resolveSuiteData();
      const taskIndexes = await resolveTaskIndexes();
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

      const task = toInternalTask(await this.tasks.resolveTask(taskIndex.taskRef));
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
    const listTasks = async (): Promise<TaskIndex[]> => {
      return resolveTaskIndexes();
    };

    const streamTask = async function* (
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
            suite: currentSuite,
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
    };

    const runTask = async (taskId: string): Promise<RunSummaryData[]> => {
      const summaries: RunSummaryData[] = [];
      for await (const event of streamTask(taskId)) {
        if (event.type === 'run:completed') {
          summaries.push(event.summary);
        }
      }
      return summaries;
    };

    return new LoadedSuite({
      getSuite: () => currentSuite,
      listTasks,
      runTask,
      streamTask,
    });
  }
}

function toInternalSuite(input: ResolvedSuite): Suite {
  return Suite.fromDocument(input.document, {
    ...(input.source ? { source: input.source } : {}),
  });
}

function toInternalTask(input: ResolvedTask): Task {
  return Task.fromDocument(input.document, input.source);
}

function mergeSuiteMetadata(base: Suite, next: Suite, taskIndexes?: TaskIndex[]): Suite {
  return Suite.fromDocument(next.definition, {
    ...(next.source ? { source: next.source } : base.source ? { source: base.source } : {}),
    ...(taskIndexes
      ? { taskIndexes }
      : next.taskIndexes
        ? { taskIndexes: [...next.taskIndexes] }
        : base.taskIndexes
          ? { taskIndexes: [...base.taskIndexes] }
          : {}),
  });
}
