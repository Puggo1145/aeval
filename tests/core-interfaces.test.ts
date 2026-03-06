import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BaselineRecord,
  ClearedResultEntry,
  ResultStoreAdapter,
} from '../src/core/adapters/result-store-adapter.js';
import type {
  ResolvedSuite,
  ResolvedTask,
  SuiteDescriptor,
  TaskRef,
  TaskSourceAdapter,
} from '../src/core/adapters/task-source-adapter.js';
import { createCore } from '../src/core/api/index.js';
import { SCHEMA_VERSIONS } from '../src/core/contracts/index.js';
import type { RunManifest } from '../src/core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../src/core/contracts/run-summary.js';
import type { SuiteDefinition } from '../src/core/contracts/suite.js';
import type { TrialResultRecord } from '../src/core/contracts/trial.js';
import { InMemoryGraderRegistry, InMemoryProviderRegistry } from '../src/core/runtime/index.js';

class InMemoryResultStoreAdapter implements ResultStoreAdapter {
  private readonly manifests = new Map<string, RunManifest>();
  private readonly summaries = new Map<string, RunSummaryRecord>();
  private readonly trials = new Map<string, TrialResultRecord[]>();
  private baselineRunId: string | null = null;

  async saveRunManifest(input: RunManifest): Promise<void> {
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

  async getRunManifest(runId: string): Promise<RunManifest | null> {
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
    return [...this.summaries.keys()].sort();
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
    const entries = [...this.summaries.keys()].sort().map((runId) => ({ path: runId, kind: 'dir' as const }));
    this.manifests.clear();
    this.summaries.clear();
    this.trials.clear();
    this.baselineRunId = null;
    return entries;
  }
}

function createSuiteDefinition(): SuiteDefinition {
  return {
    schemaVersion: 'suite.v1',
    id: 'basic-llm',
    name: 'Basic LLM',
    discover: ['datasets/**/*.yaml'],
  };
}

function createTaskSourceAdapter(): TaskSourceAdapter {
  const suiteDescriptor: SuiteDescriptor = {
    id: 'basic-llm',
    name: 'Basic LLM',
    ref: 'suites/basic.yaml',
  };

  const resolvedSuite: ResolvedSuite = {
    source: {
      adapter: 'memory',
      ref: 'suites/basic.yaml',
      fetchedAt: '2026-03-05T00:00:00.000Z',
    },
    suite: createSuiteDefinition(),
    tasks: [
      {
        id: 'basic-llm/task-001',
        desc: 'hello task',
        runCount: 2,
        taskRef: {
          suiteId: 'basic-llm',
          ref: 'datasets/task-001.yaml',
        },
      },
    ],
  };

  const resolvedTask: ResolvedTask = {
    source: {
      adapter: 'memory',
      ref: 'datasets/task-001.yaml',
      revision: 'sha256-task-001',
      fetchedAt: '2026-03-05T00:00:00.000Z',
    },
    task: {
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
    },
  };

  return {
    async listSuites(): Promise<SuiteDescriptor[]> {
      return [suiteDescriptor];
    },
    async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
      assert.equal(suiteId, 'basic-llm');
      return resolvedSuite;
    },
    async resolveTask(taskRef: TaskRef): Promise<ResolvedTask> {
      assert.equal(taskRef.ref, 'datasets/task-001.yaml');
      return resolvedTask;
    },
  };
}

function createTestCore() {
  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('mock-provider', async (_ctx, params) => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: String(params.prompt ?? ''),
    metrics: {
      latencyMs: 25,
    },
  }));

  const graderRegistry = new InMemoryGraderRegistry();
  graderRegistry.register('always-pass', async () => ({
    pass: true,
    reason: 'ok',
  }));

  return createCore({
    taskSourceAdapter: createTaskSourceAdapter(),
    resultStoreAdapter: new InMemoryResultStoreAdapter(),
    providerRegistry,
    graderRegistry,
  });
}

test('listSuites exposes adapter-backed suite discovery', async () => {
  const core = createTestCore();

  const suites = await core.listSuites();

  assert.deepEqual(suites, [
    {
      id: 'basic-llm',
      name: 'Basic LLM',
      ref: 'suites/basic.yaml',
    },
  ]);
});

test('loadSuite by id and runTask executes all provider runs', async () => {
  const core = createTestCore();
  const suite = await core.loadSuite('basic-llm');

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
  const suite = await core.loadSuite(createSuiteDefinition());

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

test('streamTask emits run lifecycle events for each provider run', async () => {
  const core = createTestCore();
  const suite = await core.loadSuite('basic-llm');
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

test('loadSuites rejects when called without inputs', async () => {
  const core = createTestCore();

  await assert.rejects(() => core.loadSuites(), /At least one suite input is required/);
});

test('createCore rejects invalid runtimeDefaults.maxConcurrency', () => {
  assert.throws(
    () =>
      createCore({
        taskSourceAdapter: createTaskSourceAdapter(),
        resultStoreAdapter: new InMemoryResultStoreAdapter(),
        providerRegistry: new InMemoryProviderRegistry(),
        graderRegistry: new InMemoryGraderRegistry(),
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
