import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BaselineRecord,
  ClearedResultEntry,
  Stores,
} from '../src/core/adapters/result-store-adapter.js';
import type {
  ResolvedSuite,
  ResolvedTask,
  SuiteDescriptor,
  TaskRef,
  Tasks,
} from '../src/core/adapters/task-source-adapter.js';
import { Core } from '../src/core/api/index.js';
import type { ExecutionResult } from '../src/core/contracts/execution.js';
import { parseTaskDocument, SCHEMA_VERSIONS } from '../src/core/contracts/index.js';
import type { RunManifestRecord } from '../src/core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../src/core/contracts/run-summary.js';
import type { SuiteDocument } from '../src/core/contracts/suite.js';
import type { TaskDocument } from '../src/core/contracts/task.js';
import type { TrialResultRecord } from '../src/core/contracts/trial.js';
import { Suite } from '../src/core/domain/suite.js';
import { Task } from '../src/core/domain/task.js';
import { Graders, Providers } from '../src/core/runtime/index.js';
import { resolveExecutionPolicy, validateTaskRuntime } from '../src/core/runtime/task-execution.js';

class InMemoryStore implements Stores {
  private readonly manifests = new Map<string, RunManifestRecord>();
  private readonly summaries = new Map<string, RunSummaryRecord>();
  private readonly trials = new Map<string, TrialResultRecord[]>();
  private baselineRunId: string | null = null;

  async saveRunManifest(input: RunManifestRecord): Promise<void> {
    this.manifests.set(input.runId, input);
  }

  async saveRunSummary(input: RunSummaryRecord): Promise<void> {
    this.summaries.set(input.runId, input);
  }

  async saveTrial(input: TrialResultRecord): Promise<void> {
    const existing = this.trials.get(input.runId) ?? [];
    existing.push(input);
    this.trials.set(input.runId, existing);
  }

  async getRunManifest(runId: string): Promise<RunManifestRecord | null> {
    return this.manifests.get(runId) ?? null;
  }

  async getRunSummary(runId: string): Promise<RunSummaryRecord | null> {
    return this.summaries.get(runId) ?? null;
  }

  async listTrials(runId: string): Promise<TrialResultRecord[]> {
    return this.trials.get(runId) ?? [];
  }

  async saveBaseline(input: BaselineRecord): Promise<void> {
    this.baselineRunId = input.runId;
  }

  async getBaselineRunId(): Promise<string | null> {
    return this.baselineRunId;
  }

  async listRunIds(): Promise<string[]> {
    return [
      ...new Set([...this.manifests.keys(), ...this.summaries.keys(), ...this.trials.keys()]),
    ].sort();
  }

  async clearResultsByRunIds(runIds: string[]): Promise<ClearedResultEntry[]> {
    const entries: ClearedResultEntry[] = [];
    for (const runId of runIds) {
      this.manifests.delete(runId);
      this.summaries.delete(runId);
      this.trials.delete(runId);
      entries.push({ path: runId, kind: 'dir' });
    }
    return entries;
  }

  async clearAllResults(): Promise<ClearedResultEntry[]> {
    const entries = [...this.summaries.keys()]
      .sort()
      .map((runId) => ({ path: runId, kind: 'dir' as const }));
    this.manifests.clear();
    this.summaries.clear();
    this.trials.clear();
    this.baselineRunId = null;
    return entries;
  }
}

function createSuiteDocument(): SuiteDocument {
  return {
    schemaVersion: 'suite.v1',
    id: 'basic-llm',
    name: 'Basic LLM',
    discover: ['datasets/**/*.yaml'],
  };
}

function createTaskDocument(): TaskDocument {
  return {
    schemaVersion: SCHEMA_VERSIONS.TASK,
    id: 'basic-llm/task-001',
    desc: 'hello task',
    provider: {
      id: 'mock-provider',
      runs: [
        {
          name: 'mini',
          params: { prompt: 'hello-mini' },
        },
        {
          name: 'nano',
          params: { prompt: 'hello-nano' },
        },
      ],
    },
    graders: {
      strategy: 'ALL',
      layers: [{ name: 'always-pass', type: 'always-pass' }],
    },
    execution: {
      timeoutMs: 1000,
      retryOnError: 0,
      trialsPerTask: 2,
    },
  };
}

function createWeightedTaskDocument(): TaskDocument {
  return {
    schemaVersion: SCHEMA_VERSIONS.TASK,
    id: 'basic-llm/task-weighted',
    provider: {
      id: 'mock-provider',
      runs: [
        {
          name: 'mini',
          params: { prompt: 'hello-mini' },
        },
      ],
    },
    graders: {
      strategy: 'WEIGHTED',
      passThreshold: 0.6,
      layers: [{ name: 'always-pass', type: 'always-pass', weight: 1 }],
    },
    execution: {
      timeoutMs: 1000,
    },
  };
}

function createTasks(): Tasks {
  const suiteDescriptor: SuiteDescriptor = {
    id: 'basic-llm',
    name: 'Basic LLM',
    ref: 'suites/basic.yaml',
  };

  const suite = Suite.fromDocument(createSuiteDocument(), {
    source: {
      adapter: 'memory',
      ref: 'suites/basic.yaml',
      fetchedAt: '2026-03-05T00:00:00.000Z',
    },
  });

  const task = Task.fromDocument(createTaskDocument(), {
    adapter: 'memory',
    ref: 'datasets/task-001.yaml',
    revision: 'sha256-task-001',
    fetchedAt: '2026-03-05T00:00:00.000Z',
  });

  return {
    async listSuites(): Promise<SuiteDescriptor[]> {
      return [suiteDescriptor];
    },
    async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
      assert.equal(suiteId, 'basic-llm');
      return {
        document: suite.toDocument(),
        source: suite.source,
        taskRefs: [
          {
            suiteId,
            ref: 'datasets/task-001.yaml',
          },
        ],
      };
    },
    async resolveTask(taskRef: TaskRef): Promise<ResolvedTask> {
      assert.equal(taskRef.ref, 'datasets/task-001.yaml');
      return {
        document: task.toDocument(),
        source: task.source!,
      };
    },
  };
}

class MockProvider {
  readonly id = 'mock-provider';

  async execute(
    _ctx: unknown,
    run: { params: Readonly<Record<string, unknown>> },
  ): Promise<ExecutionResult> {
    return {
      output: String(run.params.prompt ?? ''),
      metrics: {
        latencyMs: 25,
      },
    };
  }
}

class AlwaysPassGrader {
  readonly type = 'always-pass';

  async grade() {
    return {
      pass: true,
      reason: 'ok',
    };
  }
}

function createTestCore(stores: Stores = new InMemoryStore()) {
  const providers = new Providers();
  providers.register(new MockProvider());

  const graders = new Graders();
  graders.register(new AlwaysPassGrader());

  return new Core({
    tasks: createTasks(),
    stores,
    providers,
    graders,
  });
}

function createTestCoreWithTasks(tasks: Tasks, stores: Stores = new InMemoryStore()) {
  const providers = new Providers();
  providers.register(new MockProvider());

  const graders = new Graders();
  graders.register(new AlwaysPassGrader());

  return new Core({
    tasks,
    stores,
    providers,
    graders,
  });
}

test('listSuites exposes adapter-backed suite discovery', async () => {
  const core = createTestCore();

  const suites = await core.suites.list();

  assert.deepEqual(suites, [
    {
      id: 'basic-llm',
      name: 'Basic LLM',
      ref: 'suites/basic.yaml',
    },
  ]);
});

test('CoreApi groups adapter-backed methods by suites, results, and baseline', async () => {
  const core = createTestCore();

  const suites = await core.suites.list();
  assert.equal(suites[0]?.id, 'basic-llm');

  const suite = await core.suites.load('basic-llm');
  const summaries = await suite.runTask('basic-llm/task-001');
  const runId = summaries[0]!.runId;

  const runs = await core.results.list();
  assert.equal(runs.length, 2);

  const manifest = await core.results.getManifest(runId);
  assert.equal(manifest?.taskId, 'basic-llm/task-001');

  const summary = await core.results.getSummary(runId);
  assert.equal(summary?.runId, runId);

  const trials = await core.results.listTrials(runId);
  assert.equal(trials.length, 2);

  await core.baseline.set(runId);
  const comparison = await core.baseline.compare(runId);
  assert.equal(comparison.baselineRunId, runId);
  assert.equal(comparison.currentRunId, runId);
});

test('loadSuite by id and runTask executes all provider runs', async () => {
  const core = createTestCore();
  const suite = await core.suites.load('basic-llm');

  const summaries = await suite.runTask('basic-llm/task-001');

  assert.equal(summaries.length, 2);
  assert.deepEqual(
    summaries.map((summary) => summary.runName),
    ['mini', 'nano'],
  );
  assert.ok(summaries.every((summary) => summary.taskId === 'basic-llm/task-001'));
  assert.ok(summaries.every((summary) => summary.totalTrials === 2));
});

test('loadSuite accepts bare suite definitions and listTasks returns task indexes', async () => {
  const core = createTestCore();
  const suite = await core.suites.load(createSuiteDocument());

  const tasks = await suite.listTasks();

  assert.deepEqual(tasks, [
    {
      id: 'basic-llm/task-001',
      desc: 'hello task',
      runCount: 2,
      taskRef: {
        suiteId: 'basic-llm',
        ref: 'datasets/task-001.yaml',
      },
    },
  ]);
});

test('loadSuite syncs LoadedSuite metadata after resolving a bare suite input', async () => {
  const core = createTestCore();
  const suite = await core.suites.load(createSuiteDocument());

  const sourceBeforeListTasks = suite.source;
  const taskIndexesBeforeListTasks = suite.taskIndexes;

  assert.equal(sourceBeforeListTasks, undefined);
  assert.equal(taskIndexesBeforeListTasks, undefined);

  const taskIndexes = await suite.listTasks();

  assert.equal(suite.source?.adapter, 'memory');
  assert.deepEqual(suite.taskIndexes, taskIndexes);
});

test('core projects task indexes and rejects duplicate task ids within one suite', async () => {
  const duplicateTask = {
    ...createTaskDocument(),
    desc: 'duplicate task',
  };

  const tasks: Tasks = {
    async listSuites(): Promise<SuiteDescriptor[]> {
      return [
        {
          id: 'basic-llm',
          name: 'Basic LLM',
          ref: 'suites/basic.yaml',
        },
      ];
    },
    async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
      assert.equal(suiteId, 'basic-llm');
      return {
        document: createSuiteDocument(),
        source: {
          adapter: 'memory',
          ref: 'suites/basic.yaml',
          fetchedAt: '2026-03-05T00:00:00.000Z',
        },
        taskRefs: [
          { suiteId, ref: 'datasets/task-001.yaml' },
          { suiteId, ref: 'datasets/task-duplicate.yaml' },
        ],
      };
    },
    async resolveTask(taskRef: TaskRef): Promise<ResolvedTask> {
      return {
        document: taskRef.ref === 'datasets/task-001.yaml' ? createTaskDocument() : duplicateTask,
        source: {
          adapter: 'memory',
          ref: taskRef.ref,
          revision: `sha256-${taskRef.ref}`,
          fetchedAt: '2026-03-05T00:00:00.000Z',
        },
      };
    },
  };

  const core = createTestCoreWithTasks(tasks);
  const suite = await core.suites.load('basic-llm');

  await assert.rejects(() => suite.listTasks(), /must be unique within suite/);
});

test('loadSuite uses resolved suite metadata when persisting runs from a bare suite input', async () => {
  const store = new InMemoryStore();
  const bareSuiteDocument = createSuiteDocument();
  const resolvedSuiteDocument = {
    ...bareSuiteDocument,
    name: 'Resolved Basic LLM',
  };
  const taskDocument = createTaskDocument();

  const tasks: Tasks = {
    async listSuites(): Promise<SuiteDescriptor[]> {
      return [
        {
          id: resolvedSuiteDocument.id,
          name: resolvedSuiteDocument.name,
          ref: 'suites/basic.yaml',
        },
      ];
    },
    async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
      assert.equal(suiteId, resolvedSuiteDocument.id);
      return {
        document: resolvedSuiteDocument,
        source: {
          adapter: 'memory',
          ref: 'suites/basic.yaml',
          fetchedAt: '2026-03-05T00:00:00.000Z',
        },
        taskRefs: [
          {
            suiteId,
            ref: 'datasets/task-001.yaml',
          },
        ],
      };
    },
    async resolveTask(taskRef: TaskRef): Promise<ResolvedTask> {
      assert.equal(taskRef.ref, 'datasets/task-001.yaml');
      return {
        document: taskDocument,
        source: {
          adapter: 'memory',
          ref: 'datasets/task-001.yaml',
          revision: 'sha256-task-001',
          fetchedAt: '2026-03-05T00:00:00.000Z',
        },
      };
    },
  };

  const core = createTestCoreWithTasks(tasks, store);
  const suite = await core.suites.load(bareSuiteDocument);
  const summaries = await suite.runTask(taskDocument.id);

  assert.equal(suite.name, resolvedSuiteDocument.name);
  assert.equal(summaries.length, 2);

  const manifest = await core.results.getManifest(summaries[0]!.runId);
  assert.equal(manifest?.suiteName, resolvedSuiteDocument.name);
});

test('Task.fromDocument rejects unknown fields without external validation', () => {
  assert.throws(
    () =>
      Task.fromDocument({
        ...createTaskDocument(),
        extra: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const details =
        'details' in error && typeof error.details === 'object'
          ? (error.details as { field?: unknown })
          : {};
      assert.equal(details.field, 'task');
      return true;
    },
  );
});

test('Task factory rejects invalid weighted documents at runtime', () => {
  const invalidWeightedDoc = {
    ...createTaskDocument(),
    graders: {
      strategy: 'WEIGHTED',
      layers: [{ name: 'always-pass', type: 'always-pass', weight: 1 }],
    },
  } as TaskDocument;

  assert.throws(
    () => Task.fromDocument(invalidWeightedDoc),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const details =
        'details' in error && typeof error.details === 'object'
          ? (error.details as { field?: unknown })
          : {};
      assert.equal(details.field, 'task.graders.passThreshold');
      return true;
    },
  );
});

test('Suite.fromDocument rejects unknown fields without external validation', () => {
  assert.throws(
    () =>
      Suite.fromDocument({
        ...createSuiteDocument(),
        extra: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const details =
        'details' in error && typeof error.details === 'object'
          ? (error.details as { field?: unknown })
          : {};
      assert.equal(details.field, 'suite');
      return true;
    },
  );
});

test('Task weighted documents round-trip through toDocument and contract parsing', () => {
  const task = Task.fromDocument(createWeightedTaskDocument());
  const roundTripped = task.toDocument();

  assert.equal(roundTripped.graders.strategy, 'WEIGHTED');
  assert.equal(roundTripped.graders.passThreshold, 0.6);
  assert.equal(parseTaskDocument(roundTripped).graders.strategy, 'WEIGHTED');
});

test('Task.toDocument does not emit invalid WEIGHTED passThreshold fallback values', () => {
  const task = Task.fromDocument(createWeightedTaskDocument());
  (task as unknown as { passThreshold?: number }).passThreshold = undefined;

  assert.throws(
    () => task.toDocument(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const details =
        'details' in error && typeof error.details === 'object'
          ? (error.details as { field?: unknown })
          : {};
      assert.equal(details.field, 'task.graders.passThreshold');
      return true;
    },
  );
});

test('validateTaskRuntime and resolveExecutionPolicy cover task runtime prep', () => {
  const providers = new Providers();
  providers.register(new MockProvider());

  const graders = new Graders();
  graders.register(new AlwaysPassGrader());

  const task = Task.fromDocument({
    ...createTaskDocument(),
    execution: {
      timeoutMs: 1000,
    },
  });

  validateTaskRuntime(task, {
    providers,
    graders,
  });
  const execution = resolveExecutionPolicy(task, {
    maxConcurrency: 7,
  });

  assert.equal(execution.timeoutMs, 1000);
  assert.equal(execution.retryOnError, 0);
  assert.equal(execution.trialsPerTask, 1);
  assert.equal(execution.maxConcurrency, 7);
});

test('streamTask emits run lifecycle events for each provider run', async () => {
  const core = createTestCore();
  const suite = await core.suites.load('basic-llm');
  const eventTypes: string[] = [];
  const startedRuns: string[] = [];

  for await (const event of suite.streamTask('basic-llm/task-001')) {
    eventTypes.push(event.type);
    if (event.type === 'run:started') {
      startedRuns.push(event.runName);
      assert.equal(event.totalTrials, 2);
    }
  }

  assert.deepEqual(startedRuns, ['mini', 'nano']);
  assert.equal(eventTypes.filter((type) => type === 'run:completed').length, 2);
});

test('listRuns includes interrupted runs without summaries', async () => {
  const stores = new InMemoryStore();
  const interruptedManifest: RunManifestRecord = {
    schemaVersion: SCHEMA_VERSIONS.RUN_MANIFEST,
    runId: 'run-interrupted',
    suiteId: 'basic-llm',
    suiteName: 'Basic LLM',
    taskId: 'basic-llm/task-001',
    runName: 'mini',
    taskSource: {
      adapter: 'memory',
      ref: 'datasets/task-001.yaml',
      revision: 'sha256-task-001',
    },
    taskHash: 'task-hash-001',
    configHash: 'config-hash-001',
    startedAt: '2026-03-05T00:00:00.000Z',
  };
  await stores.saveRunManifest(interruptedManifest);
  await stores.saveTrial({
    runId: 'run-interrupted',
    trial: {
      schemaVersion: SCHEMA_VERSIONS.TRIAL_RESULT,
      taskId: 'basic-llm/task-001',
      runId: 'run-interrupted',
      runName: 'mini',
      trialIndex: 0,
      execution: {
        schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
        output: 'partial',
      },
      graderResults: [],
      aggregate: {
        pass: false,
      },
      timings: {
        startedAt: '2026-03-05T00:00:00.000Z',
        endedAt: '2026-03-05T00:00:01.000Z',
        durationMs: 1000,
      },
    },
  });
  const core = createTestCore(stores);

  const runs = await core.results.list();
  const interrupted = runs.find((run) => run.runId === 'run-interrupted');

  assert.equal(interrupted?.status, 'interrupted');
  assert.equal(interrupted?.summary, null);
  assert.equal(interrupted?.manifest?.runName, 'mini');
});

test('loadSuites rejects when called without inputs', async () => {
  const core = createTestCore();

  await assert.rejects(() => core.suites.loadMany(), /At least one suite input is required/);
});

test('Core rejects invalid runtimeDefaults.maxConcurrency', () => {
  assert.throws(
    () =>
      new Core({
        tasks: createTasks(),
        stores: new InMemoryStore(),
        providers: new Providers(),
        graders: new Graders(),
        runtimeDefaults: {
          maxConcurrency: 0,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const details =
        'details' in error && typeof error.details === 'object'
          ? (error.details as { field?: unknown })
          : {};
      assert.equal(details.field, 'runtimeDefaults.maxConcurrency');
      return true;
    },
  );
});
