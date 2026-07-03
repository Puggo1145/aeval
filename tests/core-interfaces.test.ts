import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ClearedResultEntry,
  Stores,
} from '../packages/core/src/core/adapters/result-store-adapter.js';
import type {
  ResolvedSuite,
  ResolvedTask,
  SuiteDescriptor,
  TaskRef,
  Tasks,
} from '../packages/core/src/core/adapters/task-source-adapter.js';
import { Core } from '../packages/core/src/core/api/index.js';
import type { ExecutionResult } from '../packages/core/src/core/contracts/execution.js';
import { SCHEMA_VERSIONS } from '../packages/core/src/core/contracts/index.js';
import type { RunManifestRecord } from '../packages/core/src/core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../packages/core/src/core/contracts/run-summary.js';
import type { SuiteDocument } from '../packages/core/src/core/contracts/suite.js';
import type { TaskDocument } from '../packages/core/src/core/contracts/task.js';
import type { TrialResultRecord } from '../packages/core/src/core/contracts/trial.js';
import { RunSummary } from '../packages/core/src/core/domain/run-summary.js';
import { Suite } from '../packages/core/src/core/domain/suite.js';
import { Task } from '../packages/core/src/core/domain/task.js';
import { Trial } from '../packages/core/src/core/domain/trial.js';
import { Graders, Providers } from '../packages/core/src/core/runtime/index.js';
import {
  resolveExecutionPolicy,
  validateTaskRuntime,
} from '../packages/core/src/core/runtime/task-execution.js';
import { parseTaskDocument } from '../packages/core/src/tools/index.ts';

class InMemoryStore implements Stores {
  private readonly manifests = new Map<string, RunManifestRecord>();
  private readonly summaries = new Map<string, RunSummaryRecord>();
  private readonly trials = new Map<string, TrialResultRecord[]>();

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

function createEmptySuiteDocument(): SuiteDocument {
  return {
    schemaVersion: 'suite.v1',
    id: 'empty-suite',
    name: 'Empty Suite',
    discover: [],
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
    },
  });

  const task = Task.fromDocument(createTaskDocument(), {
    adapter: 'memory',
    ref: 'datasets/task-001.yaml',
    revision: 'sha256-task-001',
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

async function saveRunSummary(
  stores: Stores,
  input: Omit<RunSummaryRecord['summary'], 'schemaVersion'>,
): Promise<void> {
  await stores.saveRunSummary({
    runId: input.runId,
    summary: {
      schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
      ...input,
    },
  });
}

async function saveRunManifest(
  stores: Stores,
  input: Omit<RunManifestRecord, 'schemaVersion'>,
): Promise<void> {
  await stores.saveRunManifest({
    schemaVersion: SCHEMA_VERSIONS.RUN_MANIFEST,
    ...input,
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

  const comparison = await core.baseline.compare(runId, {
    baselineRunId: runId,
  });
  assert.equal(comparison.taskId, 'basic-llm/task-001');
  assert.equal(comparison.baselineRunId, runId);
  assert.equal(comparison.currentRunId, runId);
  assert.ok(!('regressions' in comparison));
  assert.ok(!('improvements' in comparison));
});

test('baseline comparison stays focused on same-task metric deltas', async () => {
  const stores = new InMemoryStore();
  await saveRunSummary(stores, {
    runId: 'run-baseline',
    taskId: 'basic-llm/task-001',
    runName: 'mini',
    totalTrials: 2,
    passRate: 0.5,
    passHatK: 0,
    avgLatencyMs: 120,
  });
  await saveRunSummary(stores, {
    runId: 'run-current',
    taskId: 'basic-llm/task-001',
    runName: 'mini',
    totalTrials: 2,
    passRate: 1,
    passHatK: 1,
    avgLatencyMs: 90,
  });

  const core = createTestCore(stores);
  const comparison = await core.baseline.compare('run-current', {
    baselineRunId: 'run-baseline',
  });

  assert.deepEqual(comparison, {
    taskId: 'basic-llm/task-001',
    baselineRunId: 'run-baseline',
    currentRunId: 'run-current',
    passRateDelta: 0.5,
    passHatKDelta: 1,
    avgLatencyDelta: -30,
    verdict: 'improved',
  });
});

test('baseline comparison rejects runs from different tasks', async () => {
  const stores = new InMemoryStore();
  await saveRunSummary(stores, {
    runId: 'run-task-001',
    taskId: 'basic-llm/task-001',
    runName: 'mini',
    totalTrials: 1,
    passRate: 1,
  });
  await saveRunSummary(stores, {
    runId: 'run-task-002',
    taskId: 'basic-llm/task-002',
    runName: 'mini',
    totalTrials: 1,
    passRate: 1,
  });

  const core = createTestCore(stores);
  await assert.rejects(
    () =>
      core.baseline.compare('run-task-002', {
        baselineRunId: 'run-task-001',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /same task/);
      const details =
        'details' in error && typeof error.details === 'object'
          ? (error.details as { currentTaskId?: unknown; baselineTaskId?: unknown })
          : {};
      assert.equal(details.currentTaskId, 'basic-llm/task-002');
      assert.equal(details.baselineTaskId, 'basic-llm/task-001');
      return true;
    },
  );
});

test('run summary avgLatencyMs uses provider-reported latency rather than trial duration', () => {
  const summary = RunSummary.fromTrials('run-1', 'basic-llm/task-001', 'mini', [
    new Trial({
      taskId: 'basic-llm/task-001',
      runId: 'run-1',
      runName: 'mini',
      trialIndex: 0,
      execution: {
        output: 'ok',
        metrics: {
          latencyMs: 25,
        },
      },
      graderResults: [],
      aggregate: { pass: true },
      timings: {
        startedAt: '2026-03-05T00:00:00.000Z',
        endedAt: '2026-03-05T00:00:01.000Z',
        durationMs: 1000,
      },
    }),
    new Trial({
      taskId: 'basic-llm/task-001',
      runId: 'run-1',
      runName: 'mini',
      trialIndex: 1,
      execution: {
        output: 'ok',
        metrics: {
          latencyMs: 75,
        },
      },
      graderResults: [],
      aggregate: { pass: true },
      timings: {
        startedAt: '2026-03-05T00:00:02.000Z',
        endedAt: '2026-03-05T00:00:05.000Z',
        durationMs: 3000,
      },
    }),
  ]);

  assert.equal(summary.avgLatencyMs, 50);
});

test('baseline comparison rejects missing options with validation error', async () => {
  const stores = new InMemoryStore();
  await saveRunSummary(stores, {
    runId: 'run-current',
    taskId: 'basic-llm/task-001',
    runName: 'mini',
    totalTrials: 1,
    passRate: 1,
  });

  const core = createTestCore(stores);
  await assert.rejects(
    () => core.baseline.compare('run-current', undefined as never),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'ValidationError');
      assert.match(error.message, /Field 'options' must be an object/);
      return true;
    },
  );
});

test('loadSuite by id and runTask executes all provider runs', async () => {
  const core = createTestCore();
  const suite = await core.suites.load('basic-llm');

  const summaries = await suite.runTask('basic-llm/task-001');

  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries.map((summary) => summary.runName).sort(), ['mini', 'nano']);
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

test('loadSuite accepts bare empty suite definitions and returns no task indexes', async () => {
  const tasks: Tasks = {
    async listSuites(): Promise<SuiteDescriptor[]> {
      return [
        {
          id: 'empty-suite',
          name: 'Empty Suite',
          ref: 'suites/empty.yaml',
        },
      ];
    },
    async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
      assert.equal(suiteId, 'empty-suite');
      return {
        document: createEmptySuiteDocument(),
        source: {
          adapter: 'memory',
          ref: 'suites/empty.yaml',
        },
        taskRefs: [],
      };
    },
    async resolveTask(): Promise<ResolvedTask> {
      throw new Error('resolveTask should not be called for an empty suite.');
    },
  };

  const core = createTestCoreWithTasks(tasks);
  const suite = await core.suites.load(createEmptySuiteDocument());
  const taskIndexes = await suite.listTasks();

  assert.deepEqual(taskIndexes, []);
  assert.equal(suite.source?.adapter, 'memory');
  assert.deepEqual(suite.taskIndexes, []);
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
    trialConcurrency: 7,
  });

  assert.equal(execution.timeoutMs, 1000);
  assert.equal(execution.retryOnError, 0);
  assert.equal(execution.trialsPerTask, 1);
  assert.equal(execution.trialConcurrency, 7);
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

  assert.deepEqual(startedRuns.sort(), ['mini', 'nano']);
  assert.equal(eventTypes.filter((type) => type === 'run:completed').length, 2);
});

test('listRuns includes manifest-only runs without deriving a status', async () => {
  const stores = new InMemoryStore();
  await saveRunManifest(stores, {
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
  });
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
  const manifestOnlyRun = runs.find((run) => run.runId === 'run-interrupted');

  assert.equal(manifestOnlyRun?.summary, null);
  assert.equal(manifestOnlyRun?.manifest?.runName, 'mini');
});

test('results.list preserves store-provided runId order', async () => {
  class OrderedRunStore extends InMemoryStore {
    override async listRunIds(): Promise<string[]> {
      return ['run-b', 'run-a'];
    }
  }

  const stores = new OrderedRunStore();
  await saveRunSummary(stores, {
    runId: 'run-a',
    taskId: 'basic-llm/task-001',
    runName: 'mini',
    totalTrials: 1,
    passRate: 1,
  });
  await saveRunSummary(stores, {
    runId: 'run-b',
    taskId: 'basic-llm/task-001',
    runName: 'nano',
    totalTrials: 1,
    passRate: 1,
  });

  const core = createTestCore(stores);
  const runs = await core.results.list();

  assert.deepEqual(
    runs.map((run) => run.runId),
    ['run-b', 'run-a'],
  );
});

test('Core accepts plain provider/grader arrays and registers them internally', async () => {
  const core = new Core({
    tasks: createTasks(),
    stores: new InMemoryStore(),
    providers: [new MockProvider()],
    graders: [new AlwaysPassGrader()],
  });

  const suite = await core.suites.load('basic-llm');
  const summaries = await suite.runTask('basic-llm/task-001');

  assert.equal(summaries.length, 2);
  assert.ok(summaries.every((summary) => summary.passRate === 1));
});

test('Core rejects duplicate provider ids passed as an array', () => {
  assert.throws(
    () =>
      new Core({
        tasks: createTasks(),
        stores: new InMemoryStore(),
        providers: [new MockProvider(), new MockProvider()],
        graders: [new AlwaysPassGrader()],
      }),
    /already registered/,
  );
});

test('loadSuites rejects when called without inputs', async () => {
  const core = createTestCore();

  await assert.rejects(() => core.suites.loadMany(), /At least one suite input is required/);
});

test('streamTask executes all provider runs in parallel under one trial budget', async () => {
  // Barrier provider: every trial blocks until all 4 trials (2 runs x 2
  // trials) have started. Sequential runs would deadlock here.
  const expectedTrials = 4;
  let startedCount = 0;
  let releaseAll!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });

  const barrierProvider = {
    id: 'mock-provider',
    async execute(): Promise<ExecutionResult> {
      startedCount += 1;
      if (startedCount === expectedTrials) {
        releaseAll();
      }
      await gate;
      return { output: 'ok' };
    },
  };

  const core = new Core({
    tasks: createTasks(),
    stores: new InMemoryStore(),
    providers: [barrierProvider],
    graders: [new AlwaysPassGrader()],
  });

  const suite = await core.suites.load('basic-llm');
  const summaries = await suite.runTask('basic-llm/task-001');

  assert.equal(startedCount, expectedTrials);
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every((summary) => summary.passRate === 1));
});

test('runtimeDefaults.trialConcurrency caps concurrent trials across parallel runs of a task', async () => {
  let active = 0;
  let maxActive = 0;

  const trackingProvider = {
    id: 'mock-provider',
    async execute(): Promise<ExecutionResult> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { output: 'ok' };
    },
  };

  const taskDocument: TaskDocument = {
    ...createTaskDocument(),
    execution: {
      timeoutMs: 1000,
      trialsPerTask: 2,
    },
  };
  const task = Task.fromDocument(taskDocument, {
    adapter: 'memory',
    ref: 'datasets/task-001.yaml',
    revision: 'sha256-task-001',
  });
  const tasks: Tasks = {
    ...createTasks(),
    async resolveTask(): Promise<ResolvedTask> {
      return { document: task.toDocument(), source: task.source! };
    },
  };

  const core = new Core({
    tasks,
    stores: new InMemoryStore(),
    providers: [trackingProvider],
    graders: [new AlwaysPassGrader()],
    runtimeDefaults: { trialConcurrency: 1 },
  });

  const suite = await core.suites.load('basic-llm');
  const summaries = await suite.runTask('basic-llm/task-001');

  assert.equal(summaries.length, 2);
  assert.equal(maxActive, 1);
});

function createTwoTaskSource(): Tasks {
  const taskDocuments = ['basic-llm/task-001', 'basic-llm/task-002'].map((taskId) => ({
    ...createTaskDocument(),
    id: taskId,
    provider: {
      id: 'mock-provider',
      runs: [{ name: 'mini', params: { prompt: `${taskId}-prompt` } }],
    },
    execution: {
      timeoutMs: 1000,
      trialsPerTask: 1,
    },
  }));

  return {
    async listSuites(): Promise<SuiteDescriptor[]> {
      return [{ id: 'basic-llm', name: 'Basic LLM', ref: 'suites/basic.yaml' }];
    },
    async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
      return {
        document: createSuiteDocument(),
        source: { adapter: 'memory', ref: 'suites/basic.yaml' },
        taskRefs: taskDocuments.map((doc) => ({ suiteId, ref: `datasets/${doc.id}.yaml` })),
      };
    },
    async resolveTask(taskRef: TaskRef): Promise<ResolvedTask> {
      const document = taskDocuments.find((doc) => taskRef.ref === `datasets/${doc.id}.yaml`);
      assert.ok(document);
      return {
        document,
        source: { adapter: 'memory', ref: taskRef.ref, revision: `sha256-${document.id}` },
      };
    },
  };
}

test('streamTasks executes multiple tasks concurrently', async () => {
  // Barrier across tasks: each task has a single trial that blocks until both
  // tasks have started executing. Sequential task execution would deadlock.
  const expectedTrials = 2;
  let startedCount = 0;
  let releaseAll!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });

  const barrierProvider = {
    id: 'mock-provider',
    async execute(): Promise<ExecutionResult> {
      startedCount += 1;
      if (startedCount === expectedTrials) {
        releaseAll();
      }
      await gate;
      return { output: 'ok' };
    },
  };

  const core = new Core({
    tasks: createTwoTaskSource(),
    stores: new InMemoryStore(),
    providers: [barrierProvider],
    graders: [new AlwaysPassGrader()],
  });

  const suite = await core.suites.load('basic-llm');
  const summaries = await suite.runTasks(['basic-llm/task-001', 'basic-llm/task-002']);

  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries.map((summary) => summary.taskId).sort(), [
    'basic-llm/task-001',
    'basic-llm/task-002',
  ]);
});

test('streamTasks honors taskConcurrency as an upper bound on parallel tasks', async () => {
  let active = 0;
  let maxActive = 0;

  const trackingProvider = {
    id: 'mock-provider',
    async execute(): Promise<ExecutionResult> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { output: 'ok' };
    },
  };

  const core = new Core({
    tasks: createTwoTaskSource(),
    stores: new InMemoryStore(),
    providers: [trackingProvider],
    graders: [new AlwaysPassGrader()],
  });

  const suite = await core.suites.load('basic-llm');
  const summaries = await suite.runTasks(['basic-llm/task-001', 'basic-llm/task-002'], {
    taskConcurrency: 1,
  });

  assert.equal(summaries.length, 2);
  assert.equal(maxActive, 1);
});

test('runtimeDefaults.taskConcurrency bounds parallel tasks when the call omits it', async () => {
  let active = 0;
  let maxActive = 0;

  const trackingProvider = {
    id: 'mock-provider',
    async execute(): Promise<ExecutionResult> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { output: 'ok' };
    },
  };

  const core = new Core({
    tasks: createTwoTaskSource(),
    stores: new InMemoryStore(),
    providers: [trackingProvider],
    graders: [new AlwaysPassGrader()],
    runtimeDefaults: { taskConcurrency: 1 },
  });

  const suite = await core.suites.load('basic-llm');
  const summaries = await suite.runTasks(['basic-llm/task-001', 'basic-llm/task-002']);

  assert.equal(summaries.length, 2);
  assert.equal(maxActive, 1);
});

test('per-call taskConcurrency overrides runtimeDefaults.taskConcurrency', async () => {
  let active = 0;
  let maxActive = 0;

  const trackingProvider = {
    id: 'mock-provider',
    async execute(): Promise<ExecutionResult> {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { output: 'ok' };
    },
  };

  const core = new Core({
    tasks: createTwoTaskSource(),
    stores: new InMemoryStore(),
    providers: [trackingProvider],
    graders: [new AlwaysPassGrader()],
    runtimeDefaults: { taskConcurrency: 1 },
  });

  const suite = await core.suites.load('basic-llm');
  const summaries = await suite.runTasks(['basic-llm/task-001', 'basic-llm/task-002'], {
    taskConcurrency: 2,
  });

  assert.equal(summaries.length, 2);
  assert.equal(maxActive, 2);
});

test('Core rejects invalid runtimeDefaults.taskConcurrency', () => {
  assert.throws(
    () =>
      new Core({
        tasks: createTasks(),
        stores: new InMemoryStore(),
        providers: new Providers(),
        graders: new Graders(),
        runtimeDefaults: {
          taskConcurrency: 0,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const details =
        'details' in error && typeof error.details === 'object'
          ? (error.details as { field?: unknown })
          : {};
      assert.equal(details.field, 'runtimeDefaults.taskConcurrency');
      return true;
    },
  );
});

test('streamTasks rejects empty and duplicate taskId lists', async () => {
  const core = createTestCore();
  const suite = await core.suites.load('basic-llm');

  await assert.rejects(async () => {
    for await (const _event of suite.streamTasks([])) {
      // Unreachable: validation rejects before any event is produced.
    }
  }, /At least one taskId is required/);

  await assert.rejects(async () => {
    for await (const _event of suite.streamTasks(['basic-llm/task-001', 'basic-llm/task-001'])) {
      // Unreachable: validation rejects before any event is produced.
    }
  }, /must not contain duplicates/);
});

test('Core rejects invalid runtimeDefaults.trialConcurrency', () => {
  assert.throws(
    () =>
      new Core({
        tasks: createTasks(),
        stores: new InMemoryStore(),
        providers: new Providers(),
        graders: new Graders(),
        runtimeDefaults: {
          trialConcurrency: 0,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const details =
        'details' in error && typeof error.details === 'object'
          ? (error.details as { field?: unknown })
          : {};
      assert.equal(details.field, 'runtimeDefaults.trialConcurrency');
      return true;
    },
  );
});
