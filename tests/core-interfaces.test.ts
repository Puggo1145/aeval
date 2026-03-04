import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BaselineRecord,
  ResultStoreAdapter,
} from '../src/core/adapters/result-store-adapter.js';
import type {
  ResolvedDataset,
  TaskSourceAdapter,
} from '../src/core/adapters/task-source-adapter.js';
import { createCore } from '../src/core/api/index.js';
import { type ExperimentDefinition, SCHEMA_VERSIONS } from '../src/core/contracts/index.js';
import type { RunManifest } from '../src/core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../src/core/contracts/run-summary.js';
import type { RunEvent } from '../src/core/contracts/runtime.js';
import type { TrialResultRecord } from '../src/core/contracts/trial.js';
import {
  ContractError,
  ERROR_CODES,
  RuntimeError,
  ValidationError,
} from '../src/core/errors/index.js';
import {
  InMemoryGraderRegistry,
  InMemoryProviderRegistry,
  resolveGraderOrThrow,
  resolveProviderOrThrow,
} from '../src/core/runtime/index.js';
import { validateExperimentDefinition } from '../src/core/validation/index.js';

class InMemoryResultStoreAdapter implements ResultStoreAdapter {
  private readonly runManifests = new Map<string, RunManifest>();
  private readonly runSummaries = new Map<string, RunSummaryRecord>();
  private readonly trialRecords = new Map<string, TrialResultRecord[]>();
  private baselineRunId: string | null = null;

  async saveRunManifest(input: RunManifest): Promise<void> {
    this.runManifests.set(input.runId, input);
  }

  async saveRunSummary(input: RunSummaryRecord): Promise<void> {
    this.runSummaries.set(input.runId, input);
  }

  async saveTrial(input: TrialResultRecord): Promise<void> {
    const current = this.trialRecords.get(input.runId) ?? [];
    current.push(input);
    this.trialRecords.set(input.runId, current);
  }

  async getRunManifest(runId: string): Promise<RunManifest | null> {
    return this.runManifests.get(runId) ?? null;
  }

  async getRunSummary(runId: string): Promise<RunSummaryRecord | null> {
    return this.runSummaries.get(runId) ?? null;
  }

  async listTrials(runId: string): Promise<TrialResultRecord[]> {
    return this.trialRecords.get(runId) ?? [];
  }

  async saveBaseline(input: BaselineRecord): Promise<void> {
    this.baselineRunId = input.runId;
  }

  async getBaselineRunId(): Promise<string | null> {
    return this.baselineRunId;
  }

  async listRunIds(): Promise<string[]> {
    return [...this.runSummaries.keys()].sort();
  }
}

function createExperimentDefinition(): ExperimentDefinition {
  return validateExperimentDefinition({
    name: 'milestone-2-smoke',
    runs: [
      {
        name: 'baseline',
      },
    ],
    maxConcurrency: 1,
  });
}

function createTaskSourceAdapter(): TaskSourceAdapter {
  return {
    async resolveDataset(): Promise<ResolvedDataset> {
      return {
        source: {
          adapter: 'local-task-source',
          ref: 'dataset://chat-agent/smoke',
          revision: 'rev-001',
          fetchedAt: '2026-02-28T00:00:00.000Z',
        },
        tasks: [],
        datasetHash: 'hash-001',
      };
    },
  };
}

function createRunSummaryRecord(
  runId: string,
  runName: string,
  values?: Partial<{ passRate: number; passHatK: number; avgLatencyMs: number }>,
): RunSummaryRecord {
  return {
    runId,
    summary: {
      schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
      runId,
      runName,
      totalTasks: 2,
      totalTrials: 2,
      passRate: values?.passRate ?? 0,
      passHatK: values?.passHatK,
      avgLatencyMs: values?.avgLatencyMs,
    },
  };
}

function createTrialRecord(
  runId: string,
  taskId: string,
  pass: boolean,
  trialIndex = 0,
): TrialResultRecord {
  return {
    runId,
    trial: {
      schemaVersion: SCHEMA_VERSIONS.TRIAL_RESULT,
      taskId,
      runId,
      runName: runId,
      trialIndex,
      execution: {
        schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
        output: pass ? 'ok' : 'fail',
      },
      graderResults: [],
      aggregate: {
        pass,
      },
      timings: {
        startedAt: '2026-02-28T00:00:00.000Z',
        endedAt: '2026-02-28T00:00:01.000Z',
        durationMs: 1000,
      },
    },
  };
}

function createCoreWithStore(resultStoreAdapter: ResultStoreAdapter) {
  return createCore({
    taskSourceAdapter: createTaskSourceAdapter(),
    resultStoreAdapter,
    observerAdapters: [
      {
        onEvent: () => {},
      },
    ],
    providerRegistry: new InMemoryProviderRegistry(),
    graderRegistry: new InMemoryGraderRegistry(),
  });
}

test('provider registry supports register/get/has/list', () => {
  const registry = new InMemoryProviderRegistry();
  const provider = async () => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: 'ok',
  });

  registry.register('mock-provider', provider);

  assert.equal(registry.get('mock-provider'), provider);
  assert.equal(registry.has('mock-provider'), true);
  assert.deepEqual(registry.list(), ['mock-provider']);
});

test('provider registry rejects duplicate provider id', () => {
  const registry = new InMemoryProviderRegistry();
  const provider = async () => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: 'ok',
  });

  registry.register('mock-provider', provider);

  assert.throws(
    () => registry.register('mock-provider', provider),
    (error: unknown) => {
      assert.ok(error instanceof ContractError);
      assert.equal(error.code, ERROR_CODES.CONTRACT_VIOLATION);
      return true;
    },
  );
});

test('grader registry supports register/get/has/list', () => {
  const registry = new InMemoryGraderRegistry();
  const grader = async () => ({
    pass: true,
    reason: 'ok',
  });

  registry.register('contains', grader);

  assert.equal(registry.get('contains'), grader);
  assert.equal(registry.has('contains'), true);
  assert.deepEqual(registry.list(), ['contains']);
});

test('resolveProviderOrThrow and resolveGraderOrThrow fail fast with explicit error', () => {
  const providerRegistry = new InMemoryProviderRegistry();
  const graderRegistry = new InMemoryGraderRegistry();

  assert.throws(
    () => resolveProviderOrThrow('missing-provider', providerRegistry),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, ERROR_CODES.RUNTIME_DEPENDENCY_MISSING);
      return true;
    },
  );

  assert.throws(
    () => resolveGraderOrThrow('missing-grader', graderRegistry),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, ERROR_CODES.RUNTIME_DEPENDENCY_MISSING);
      return true;
    },
  );
});

test('loadExperiment + run completes with empty dataset and returns summary', async () => {
  const resultStore = new InMemoryResultStoreAdapter();
  const core = createCore({
    taskSourceAdapter: createTaskSourceAdapter(),
    resultStoreAdapter: resultStore,
    observerAdapters: [
      {
        onEvent: () => {},
      },
    ],
    providerRegistry: new InMemoryProviderRegistry(),
    graderRegistry: new InMemoryGraderRegistry(),
  });

  const experiment = await core.loadExperiment(createExperimentDefinition());
  const summary = await experiment.run('baseline');

  assert.equal(summary.schemaVersion, 'run-summary.v1');
  assert.equal(summary.runName, 'baseline');
  assert.equal(summary.totalTasks, 0);
  assert.equal(summary.totalTrials, 0);
  assert.equal(summary.passRate, 0);
});

test('loadExperiment + stream emits run:started and run:completed events', async () => {
  const core = createCore({
    taskSourceAdapter: createTaskSourceAdapter(),
    resultStoreAdapter: new InMemoryResultStoreAdapter(),
    observerAdapters: [
      {
        onEvent: () => {},
      },
    ],
    providerRegistry: new InMemoryProviderRegistry(),
    graderRegistry: new InMemoryGraderRegistry(),
  });

  const experiment = await core.loadExperiment(createExperimentDefinition());
  const events: RunEvent[] = [];
  for await (const event of experiment.stream('baseline')) {
    events.push(event);
  }

  assert.equal(events.length, 2);
  assert.equal(events[0]?.type, 'run:started');
  assert.equal(events[1]?.type, 'run:completed');
});

test('getRunSummary and listTrials return data from the ResultStoreAdapter', async () => {
  const store = new InMemoryResultStoreAdapter();
  await store.saveRunSummary(createRunSummaryRecord('run-1', 'run-1'));
  await store.saveTrial(createTrialRecord('run-1', 'task-1', true));

  const core = createCoreWithStore(store);

  const summary = await core.getRunSummary('run-1');
  const trials = await core.listTrials('run-1');

  assert.equal(summary?.runId, 'run-1');
  assert.equal(trials.length, 1);
  assert.equal(trials[0]?.trial.taskId, 'task-1');
});

test('getRunSummary returns null and listTrials returns empty array when run is not found', async () => {
  const core = createCoreWithStore(new InMemoryResultStoreAdapter());

  const summary = await core.getRunSummary('missing-run');
  const trials = await core.listTrials('missing-run');

  assert.equal(summary, null);
  assert.deepEqual(trials, []);
});

test('setBaseline writes baseline to the ResultStoreAdapter', async () => {
  const store = new InMemoryResultStoreAdapter();
  await store.saveRunSummary(createRunSummaryRecord('baseline-run', 'baseline-run'));

  const core = createCoreWithStore(store);

  await core.setBaseline('baseline-run');

  assert.equal(await store.getBaselineRunId(), 'baseline-run');
});

test('setBaseline fails when run cannot be found in the ResultStoreAdapter', async () => {
  const core = createCoreWithStore(new InMemoryResultStoreAdapter());

  await assert.rejects(
    async () => core.setBaseline('missing-run'),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, ERROR_CODES.VALIDATION_INVALID_INPUT);
      return true;
    },
  );
});

test('compareBaseline calculates deltas and returns regressed verdict', async () => {
  const store = new InMemoryResultStoreAdapter();
  await store.saveRunSummary(
    createRunSummaryRecord('baseline', 'baseline', {
      passRate: 0.9,
      passHatK: 0.8,
      avgLatencyMs: 100,
    }),
  );
  await store.saveRunSummary(
    createRunSummaryRecord('current', 'current', {
      passRate: 0.75,
      passHatK: 0.6,
      avgLatencyMs: 130,
    }),
  );
  await store.saveTrial(createTrialRecord('baseline', 'task-a', true));
  await store.saveTrial(createTrialRecord('baseline', 'task-b', true));
  await store.saveTrial(createTrialRecord('current', 'task-a', false));
  await store.saveTrial(createTrialRecord('current', 'task-b', true));

  const core = createCoreWithStore(store);

  const comparison = await core.compareBaseline('current', {
    baselineRunId: 'baseline',
    thresholds: {
      passRateDrop: 0.05,
      passHatKDrop: 0.1,
      avgLatencyIncrease: 20,
    },
  });

  assert.equal(comparison.verdict, 'regressed');
  assert.ok(Math.abs(comparison.passRateDelta - -0.15) < 1e-10);
  assert.ok(Math.abs((comparison.passHatKDelta ?? 0) - -0.2) < 1e-10);
  assert.equal(comparison.avgLatencyDelta, 30);
  assert.deepEqual(comparison.regressions, ['task-a']);
});

test('compareBaseline uses baseline pointer from the store by default', async () => {
  const store = new InMemoryResultStoreAdapter();
  await store.saveRunSummary(
    createRunSummaryRecord('baseline', 'baseline', {
      passRate: 0.8,
      avgLatencyMs: 120,
    }),
  );
  await store.saveRunSummary(
    createRunSummaryRecord('current', 'current', {
      passRate: 0.85,
      avgLatencyMs: 100,
    }),
  );
  await store.saveTrial(createTrialRecord('baseline', 'task-a', true));
  await store.saveTrial(createTrialRecord('current', 'task-a', true));
  await store.saveBaseline({
    runId: 'baseline',
    updatedAt: '2026-02-28T00:00:00.000Z',
  });

  const core = createCoreWithStore(store);

  const comparison = await core.compareBaseline('current');

  assert.equal(comparison.baselineRunId, 'baseline');
  assert.equal(comparison.verdict, 'improved');
  assert.ok((comparison.avgLatencyDelta ?? 0) < 0);
});

test('compareBaseline fails when current run cannot be found in the ResultStoreAdapter', async () => {
  const core = createCoreWithStore(new InMemoryResultStoreAdapter());

  await assert.rejects(
    async () => core.compareBaseline('current', { baselineRunId: 'baseline' }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, ERROR_CODES.VALIDATION_INVALID_INPUT);
      return true;
    },
  );
});

test('compareBaseline rejects invalid threshold values', async () => {
  const store = new InMemoryResultStoreAdapter();
  await store.saveRunSummary(createRunSummaryRecord('baseline', 'baseline'));
  await store.saveRunSummary(createRunSummaryRecord('current', 'current'));
  await store.saveBaseline({
    runId: 'baseline',
    updatedAt: '2026-02-28T00:00:00.000Z',
  });

  const core = createCoreWithStore(store);

  await assert.rejects(
    async () =>
      core.compareBaseline('current', {
        thresholds: {
          passRateDrop: -0.1,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, ERROR_CODES.VALIDATION_INVALID_INPUT);
      return true;
    },
  );

  await assert.rejects(
    async () =>
      core.compareBaseline('current', {
        thresholds: {
          avgLatencyIncrease: Number.NaN,
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, ERROR_CODES.VALIDATION_INVALID_INPUT);
      return true;
    },
  );
});

test('listRuns returns sorted run summaries from the store', async () => {
  const store = new InMemoryResultStoreAdapter();
  await store.saveRunSummary(createRunSummaryRecord('run-b', 'run-b'));
  await store.saveRunSummary(createRunSummaryRecord('run-a', 'run-a'));

  const core = createCoreWithStore(store);

  const runs = await core.listRuns();
  assert.deepEqual(
    runs.map((record) => record.runId),
    ['run-a', 'run-b'],
  );
});
