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
  Grader,
  Graders,
  Provider,
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
import { mergeAsyncIterables } from '../orchestrator/merge-streams.js';
import { TaskRunOrchestrator } from '../orchestrator/run-orchestrator.js';
import { Semaphore } from '../orchestrator/semaphore.js';
import { Graders as GraderRegistry } from '../runtime/grader-registry.js';
import { Providers as ProviderRegistry } from '../runtime/provider-registry.js';
import { resolveExecutionPolicy, validateTaskRuntime } from '../runtime/task-execution.js';
import { ensureNonEmptyString } from '../validation/helpers.js';
import {
  normalizeRuntimeDefaults,
  type ResolvedRuntimeDefaults,
} from '../validation/runtime-defaults.js';
import {
  computeVerdict,
  validateBaselineThresholds,
  validateComparableDelta,
} from './baseline-utils.js';

export type LoadSuiteInput = string | SuiteInput | Promise<SuiteInput>;

export interface RunTaskOptions {
  signal?: AbortSignal;
}

export interface RunTasksOptions extends RunTaskOptions {
  /**
   * Max tasks executing concurrently. Defaults to all requested tasks; each
   * task's trial concurrency is still capped by `runtimeDefaults.trialConcurrency`.
   */
  taskConcurrency?: number;
}

export interface CompareBaselineOptions {
  baselineRunId: string;
  thresholds?: BaselineThresholds;
  tokenBudgetBreached?: boolean;
}

export interface CoreDependencies {
  tasks: Tasks;
  stores: Stores;
  /** A prebuilt registry, or a plain array registered into one internally. */
  providers: Providers | Provider[];
  /** A prebuilt registry, or a plain array registered into one internally. */
  graders: Graders | Grader[];
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

/**
 * Public execution handle for one loaded suite. It binds the pure `Suite`
 * definition to task discovery and execution, caching resolved suite metadata
 * and tasks for the lifetime of the handle.
 */
export class LoadedSuite {
  private suite: Suite;
  private resolvedSuitePromise?: Promise<ResolvedSuite>;
  private taskIndexesPromise?: Promise<TaskIndex[]>;
  private resolvedTaskIndexes?: TaskIndex[];
  private readonly taskCache = new Map<string, Task>();

  constructor(
    private readonly core: Core,
    suite: Suite,
    preloadedResolvedSuite?: ResolvedSuite,
  ) {
    this.suite = suite;
    if (preloadedResolvedSuite) {
      this.resolvedSuitePromise = Promise.resolve(preloadedResolvedSuite);
    }
  }

  get schemaVersion(): Suite['schemaVersion'] {
    return this.suite.schemaVersion;
  }

  get id(): string {
    return this.suite.id;
  }

  get name(): string {
    return this.suite.name;
  }

  get discover(): readonly string[] {
    return this.suite.discover;
  }

  get source(): Suite['source'] {
    return this.suite.source;
  }

  /** Task indexes resolved so far; `undefined` until `listTasks()` completes. */
  get taskIndexes(): readonly TaskIndex[] | undefined {
    return this.resolvedTaskIndexes;
  }

  get definition(): SuiteDocument {
    return this.suite.toDocument();
  }

  async listTasks(): Promise<TaskIndex[]> {
    if (!this.taskIndexesPromise) {
      this.taskIndexesPromise = this.buildTaskIndexes();
    }
    return this.taskIndexesPromise;
  }

  async runTask(taskId: string, options?: RunTaskOptions): Promise<RunSummaryData[]> {
    const summaries: RunSummaryData[] = [];
    for await (const event of this.streamTask(taskId, options)) {
      if (event.type === 'run:completed') {
        summaries.push(event.summary);
      }
    }
    return summaries;
  }

  /**
   * Execute one task: all of its runs proceed in parallel, sharing
   * `runtimeDefaults.trialConcurrency` as a single trial budget. Events from
   * different runs interleave; each carries `runId`/`runName` for correlation.
   */
  async *streamTask(taskId: string, options?: RunTaskOptions): AsyncIterable<RunEvent> {
    const task = await this.resolveTaskById(taskId);
    validateTaskRuntime(task, {
      providers: this.core.providers,
      graders: this.core.graders,
    });
    const execution = resolveExecutionPolicy(task, this.core.runtimeDefaults);
    const trialPermits = new Semaphore(execution.trialConcurrency);

    if (options?.signal?.aborted) {
      return;
    }

    const runStreams = task.runs.map(
      (run) => () =>
        new TaskRunOrchestrator(
          {
            suite: this.suite,
            task,
            run,
            execution,
            signal: options?.signal,
            trialPermits,
          },
          {
            stores: this.core.stores,
            observers: this.core.observers,
            providers: this.core.providers,
            graders: this.core.graders,
          },
        ).run(),
    );

    yield* mergeAsyncIterables(runStreams);
  }

  async runTasks(taskIds: string[], options?: RunTasksOptions): Promise<RunSummaryData[]> {
    const summaries: RunSummaryData[] = [];
    for await (const event of this.streamTasks(taskIds, options)) {
      if (event.type === 'run:completed') {
        summaries.push(event.summary);
      }
    }
    return summaries;
  }

  /**
   * Execute several tasks concurrently (all at once unless `taskConcurrency`
   * bounds it), merging their event streams into one.
   */
  async *streamTasks(taskIds: string[], options?: RunTasksOptions): AsyncIterable<RunEvent> {
    if (taskIds.length === 0) {
      throw new ValidationError('At least one taskId is required.', {
        details: { field: 'taskIds' },
      });
    }

    const uniqueTaskIds = new Set(taskIds.map((taskId) => ensureNonEmptyString(taskId, 'taskIds')));
    if (uniqueTaskIds.size !== taskIds.length) {
      throw new ValidationError("Field 'taskIds' must not contain duplicates.", {
        details: { field: 'taskIds', taskIds },
      });
    }

    if (
      options?.taskConcurrency !== undefined &&
      (!Number.isInteger(options.taskConcurrency) || options.taskConcurrency <= 0)
    ) {
      throw new ValidationError("Field 'taskConcurrency' must be a positive integer.", {
        details: { field: 'taskConcurrency', taskConcurrency: options.taskConcurrency },
      });
    }

    // Resolve every task upfront so configuration errors surface before any
    // trial executes.
    for (const taskId of taskIds) {
      const task = await this.resolveTaskById(taskId);
      validateTaskRuntime(task, {
        providers: this.core.providers,
        graders: this.core.graders,
      });
    }

    const taskStreams = taskIds.map(
      (taskId) => () =>
        this.streamTask(taskId, options?.signal ? { signal: options.signal } : undefined),
    );

    // Per-call `taskConcurrency` wins; otherwise fall back to the runtime
    // default, and finally to unbounded (all tasks at once).
    const taskConcurrency = options?.taskConcurrency ?? this.core.runtimeDefaults.taskConcurrency;

    yield* mergeAsyncIterables(taskStreams, {
      ...(taskConcurrency !== undefined ? { concurrency: taskConcurrency } : {}),
    });
  }

  private resolveSuiteData(): Promise<ResolvedSuite> {
    if (!this.resolvedSuitePromise) {
      this.resolvedSuitePromise = this.core.tasks.resolveSuite(this.suite.id).then((resolved) => {
        // Adopt adapter-resolved metadata (name, source) for bare suite inputs.
        this.suite = toInternalSuite(resolved);
        return resolved;
      });
    }
    return this.resolvedSuitePromise;
  }

  private async buildTaskIndexes(): Promise<TaskIndex[]> {
    const resolved = await this.resolveSuiteData();
    const taskIndexes: TaskIndex[] = [];

    for (const taskRef of resolved.taskRefs) {
      const task = toInternalTask(await this.core.tasks.resolveTask(taskRef));
      if (this.taskCache.has(task.id)) {
        throw new RuntimeError(`Task id '${task.id}' must be unique within suite '${this.id}'.`, {
          code: ERROR_CODES.RUNTIME_UNEXPECTED,
          details: {
            suiteId: this.id,
            taskId: task.id,
            taskRef: taskRef.ref,
          },
        });
      }

      this.taskCache.set(task.id, task);
      taskIndexes.push(taskIndexFromDomainTask(task, taskRef));
    }

    this.resolvedTaskIndexes = taskIndexes;
    return taskIndexes;
  }

  private async resolveTaskById(taskId: string): Promise<Task> {
    const normalizedTaskId = ensureNonEmptyString(taskId, 'taskId');
    await this.listTasks();

    const task = this.taskCache.get(normalizedTaskId);
    if (!task) {
      throw new ValidationError(
        `Task '${normalizedTaskId}' is not defined in suite '${this.id}'.`,
        {
          details: {
            field: 'taskId',
            suiteId: this.id,
            taskId: normalizedTaskId,
            knownTaskIds: [...this.taskCache.keys()],
          },
        },
      );
    }

    return task;
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

function toProviders(input: Providers | Provider[]): Providers {
  if (!Array.isArray(input)) {
    return input;
  }

  const registry = new ProviderRegistry();
  for (const provider of input) {
    registry.register(provider);
  }
  return registry;
}

function toGraders(input: Graders | Grader[]): Graders {
  if (!Array.isArray(input)) {
    return input;
  }

  const registry = new GraderRegistry();
  for (const grader of input) {
    registry.register(grader);
  }
  return registry;
}

export class Core implements CoreApi {
  readonly tasks: Tasks;
  readonly stores: Stores;
  readonly providers: Providers;
  readonly graders: Graders;
  readonly observers: readonly Observer[];
  readonly runtimeDefaults: ResolvedRuntimeDefaults;
  readonly suites: CoreSuitesApi;
  readonly results: CoreResultsApi;
  readonly baseline: CoreBaselineApi;

  constructor(input: CoreDependencies) {
    this.tasks = input.tasks;
    this.stores = input.stores;
    this.providers = toProviders(input.providers);
    this.graders = toGraders(input.graders);
    this.observers = Object.freeze([...(input.observers ?? [])]);
    this.runtimeDefaults = normalizeRuntimeDefaults(input.runtimeDefaults);
    this.suites = Object.freeze({
      list: () => this.tasks.listSuites(),
      load: (suite: LoadSuiteInput) => this.loadSuiteHandle(suite),
      loadMany: (...inputs: LoadSuiteInput[]) => this.loadSuiteHandles(...inputs),
    });
    this.results = Object.freeze({
      list: () => this.listRunRecords(),
      getManifest: (runId: string) => this.getRunManifestRecord(runId),
      getSummary: (runId: string) => this.getRunSummaryData(runId),
      listTrials: (runId: string) => this.listTrialRecords(runId),
      clearAll: () => this.stores.clearAllResults(),
      clearByRunIds: (runIds: string[]) => this.stores.clearResultsByRunIds(runIds),
    });
    this.baseline = Object.freeze({
      compare: (currentRunId: string, options: CompareBaselineOptions) =>
        this.compareAgainstBaseline(currentRunId, options),
    });
  }

  private async loadSuiteHandle(input: LoadSuiteInput): Promise<LoadedSuite> {
    if (typeof input === 'string') {
      const suiteId = ensureNonEmptyString(input, 'suiteId');
      const resolvedSuite = await this.tasks.resolveSuite(suiteId);
      return new LoadedSuite(this, toInternalSuite(resolvedSuite), resolvedSuite);
    }

    const raw = await input;
    return new LoadedSuite(this, Suite.fromDocument(raw));
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

    const currentSummary = await this.requireRunSummary(normalizedCurrentRunId, 'currentRunId');
    const baselineSummary = await this.requireRunSummary(baselineRunId, 'baselineRunId');

    if (currentSummary.taskId !== baselineSummary.taskId) {
      throw new ValidationError(
        `Baseline compare requires runs from the same task. Current run '${normalizedCurrentRunId}' belongs to '${currentSummary.taskId}' while baseline run '${baselineRunId}' belongs to '${baselineSummary.taskId}'.`,
        {
          details: {
            field: 'taskId',
            currentRunId: normalizedCurrentRunId,
            currentTaskId: currentSummary.taskId,
            baselineRunId,
            baselineTaskId: baselineSummary.taskId,
          },
        },
      );
    }

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

    return {
      taskId: currentSummary.taskId,
      baselineRunId,
      currentRunId: normalizedCurrentRunId,
      passRateDelta,
      ...(passHatKDelta !== undefined ? { passHatKDelta } : {}),
      ...(avgLatencyDelta !== undefined ? { avgLatencyDelta } : {}),
      ...(options.tokenBudgetBreached !== undefined
        ? { tokenBudgetBreached: options.tokenBudgetBreached }
        : {}),
      verdict: computeVerdict(
        {
          passRateDelta,
          passHatKDelta,
          avgLatencyDelta,
          tokenBudgetBreached: options.tokenBudgetBreached,
        },
        options.thresholds,
      ),
    };
  }

  private async requireRunSummary(runId: string, field: string): Promise<RunSummary> {
    const record = await this.stores.getRunSummary(runId);
    if (!record) {
      throw new ValidationError(`Run summary for '${runId}' was not found.`, {
        details: { field, runId },
      });
    }
    return RunSummary.fromRecord(record.summary);
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
        manifest: manifestRecord,
        summary: summaryRecord?.summary ?? null,
      });
    }

    return records;
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
