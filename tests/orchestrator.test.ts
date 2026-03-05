import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObserverAdapter } from '../src/core/adapters/observer-adapter.js';
import type {
  BaselineRecord,
  ClearedResultEntry,
  ResultStoreAdapter,
} from '../src/core/adapters/result-store-adapter.js';
import type {
  ResolvedDataset,
  TaskSourceAdapter,
} from '../src/core/adapters/task-source-adapter.js';
import { createCore } from '../src/core/api/index.js';
import { type ExecutionResult, SYSTEM_ERROR_CODES } from '../src/core/contracts/execution.js';
import {
  type ExperimentDefinition,
  type RunEvent,
  SCHEMA_VERSIONS,
} from '../src/core/contracts/index.js';
import type { RunManifest } from '../src/core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../src/core/contracts/run-summary.js';
import type { TaskDefinition } from '../src/core/contracts/task.js';
import type { TrialResultRecord } from '../src/core/contracts/trial.js';
import { ValidationError } from '../src/core/errors/index.js';
import { computeConfigHash } from '../src/core/orchestrator/config-hash.js';
import { aggregateGraders } from '../src/core/orchestrator/grader-aggregate.js';
import { orchestrateRun } from '../src/core/orchestrator/run-orchestrator.js';
import { StreamClosedError } from '../src/core/runtime/abort-reasons.js';
import { InMemoryGraderRegistry, InMemoryProviderRegistry } from '../src/core/runtime/index.js';
import { validateExperimentDefinition } from '../src/core/validation/index.js';
import { registerBuiltinGraders } from '../src/graders/register-builtins.js';

// --- Test helpers ---

class InMemoryResultStoreAdapter implements ResultStoreAdapter {
  readonly runManifests = new Map<string, RunManifest>();
  readonly runSummaries = new Map<string, RunSummaryRecord>();
  readonly trialRecords = new Map<string, TrialResultRecord[]>();
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
  async clearAllResults(): Promise<ClearedResultEntry[]> {
    const deletedEntries: ClearedResultEntry[] = [];
    const runIds = new Set([
      ...this.runManifests.keys(),
      ...this.runSummaries.keys(),
      ...this.trialRecords.keys(),
    ]);
    for (const runId of [...runIds].sort()) {
      deletedEntries.push({ path: runId, kind: 'dir' });
    }
    if (this.baselineRunId) {
      deletedEntries.push({ path: 'baseline.json', kind: 'file' });
    }

    this.runManifests.clear();
    this.runSummaries.clear();
    this.trialRecords.clear();
    this.baselineRunId = null;
    return deletedEntries;
  }

  async clearResultsByRunIds(runIds: string[]): Promise<ClearedResultEntry[]> {
    const normalizedRunIds = [...new Set(runIds)].sort();
    const deletedEntries: ClearedResultEntry[] = [];

    for (const runId of normalizedRunIds) {
      const hadAnyData =
        this.runManifests.has(runId) || this.runSummaries.has(runId) || this.trialRecords.has(runId);
      this.runManifests.delete(runId);
      this.runSummaries.delete(runId);
      this.trialRecords.delete(runId);
      if (hadAnyData) {
        deletedEntries.push({ path: runId, kind: 'dir' });
      }
    }

    if (this.baselineRunId && normalizedRunIds.includes(this.baselineRunId)) {
      this.baselineRunId = null;
      deletedEntries.push({ path: 'baseline.json', kind: 'file' });
    }

    return deletedEntries;
  }
}

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    schemaVersion: SCHEMA_VERSIONS.TASK,
    id: 'test-task-1',
    provider: { id: 'mock-provider' },
    graders: {
      strategy: 'ALL',
      layers: [{ name: 'always-pass', type: 'always-pass' }],
    },
    execution: { timeoutMs: 5000 },
    ...overrides,
  } as TaskDefinition;
}

function makeExperiment(overrides: Partial<ExperimentDefinition> = {}): ExperimentDefinition {
  return validateExperimentDefinition({
    name: 'test-experiment',
    dataset: 'test-dataset',
    runs: [{ name: 'default' }],
    maxConcurrency: 2,
    ...overrides,
  });
}

function createMockTaskSource(tasks: unknown[] = []): TaskSourceAdapter {
  return {
    async resolveDataset(_selector): Promise<ResolvedDataset> {
      return {
        source: {
          adapter: 'local',
          ref: 'dataset://test',
          revision: 'rev-001',
          fetchedAt: '2026-02-28T00:00:00.000Z',
        },
        tasks,
        datasetHash: 'test-hash-001',
      };
    },
  };
}

function createPassingProvider() {
  return async (): Promise<ExecutionResult> => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: 'hello world',
    metrics: { latencyMs: 42 },
  });
}

function createFailingProvider() {
  return async (): Promise<ExecutionResult> => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: '',
    error: { type: 'agent', message: 'Agent failed' },
  });
}

function createSlowProvider(delayMs: number) {
  return async (_ctx: unknown, _params: unknown): Promise<ExecutionResult> => {
    const ctx = _ctx as { signal: AbortSignal };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({
          schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
          output: 'slow result',
        });
      }, delayMs);

      ctx.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  };
}

function createNonCooperativeSlowProvider(delayMs: number) {
  return async (): Promise<ExecutionResult> =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
          output: 'late result',
        });
      }, delayMs);
    });
}

interface TestCoreSetup {
  resultStore: InMemoryResultStoreAdapter;
  providerRegistry: InMemoryProviderRegistry;
  graderRegistry: InMemoryGraderRegistry;
  observerEvents: RunEvent[];
  tasks: unknown[];
}

function setupTestCore(opts: Partial<TestCoreSetup> = {}) {
  const resultStore = opts.resultStore ?? new InMemoryResultStoreAdapter();
  const providerRegistry = opts.providerRegistry ?? new InMemoryProviderRegistry();
  const graderRegistry = opts.graderRegistry ?? new InMemoryGraderRegistry();
  const observerEvents: RunEvent[] = opts.observerEvents ?? [];
  const tasks = opts.tasks ?? [];

  // Register default grader
  if (!graderRegistry.has('always-pass')) {
    graderRegistry.register('always-pass', async () => ({ pass: true, reason: 'always passes' }));
  }

  const observer: ObserverAdapter = {
    onEvent(event) {
      observerEvents.push(event);
    },
  };

  const core = createCore({
    taskSourceAdapter: createMockTaskSource(tasks),
    resultStoreAdapter: resultStore,
    observerAdapters: [observer],
    providerRegistry,
    graderRegistry,
  });

  return { core, resultStore, providerRegistry, graderRegistry, observerEvents };
}

// --- Grader Aggregate Tests ---

test('grader aggregate ALL strategy passes when all graders pass', async () => {
  const result = await aggregateGraders({
    execution: { schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT, output: 'test' },
    layers: [
      { name: 'g1', type: 'pass' },
      { name: 'g2', type: 'pass' },
    ],
    strategy: 'ALL',
    resolveGrader: () => async () => ({ pass: true, reason: 'ok' }),
  });

  assert.equal(result.aggregate.pass, true);
  assert.equal(result.graderResults.length, 2);
});

test('grader aggregate ALL strategy fails when any grader fails', async () => {
  let callCount = 0;
  const result = await aggregateGraders({
    execution: { schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT, output: 'test' },
    layers: [
      { name: 'g1', type: 'pass' },
      { name: 'g2', type: 'fail' },
    ],
    strategy: 'ALL',
    resolveGrader: (type) => async () => {
      callCount++;
      return { pass: type === 'pass', reason: type };
    },
  });

  assert.equal(result.aggregate.pass, false);
});

test('grader aggregate ANY strategy passes when at least one grader passes', async () => {
  const result = await aggregateGraders({
    execution: { schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT, output: 'test' },
    layers: [
      { name: 'g1', type: 'fail' },
      { name: 'g2', type: 'pass' },
    ],
    strategy: 'ANY',
    resolveGrader: (type) => async () => ({ pass: type === 'pass', reason: type }),
  });

  assert.equal(result.aggregate.pass, true);
});

test('grader aggregate ANY strategy fails when all graders fail', async () => {
  const result = await aggregateGraders({
    execution: { schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT, output: 'test' },
    layers: [
      { name: 'g1', type: 'fail' },
      { name: 'g2', type: 'fail' },
    ],
    strategy: 'ANY',
    resolveGrader: () => async () => ({ pass: false, reason: 'fail' }),
  });

  assert.equal(result.aggregate.pass, false);
});

test('grader aggregate WEIGHTED strategy uses score and threshold', async () => {
  const result = await aggregateGraders({
    execution: { schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT, output: 'test' },
    layers: [
      { name: 'g1', type: 'a', weight: 2.0 },
      { name: 'g2', type: 'b', weight: 1.0 },
    ],
    strategy: 'WEIGHTED',
    passThreshold: 0.6,
    resolveGrader: (type) => async () => ({
      pass: type === 'a',
      score: type === 'a' ? 0.8 : 0.2,
      reason: type,
    }),
  });

  // weighted score = (0.8*2 + 0.2*1) / (2+1) = 1.8/3 = 0.6
  assert.equal(result.aggregate.pass, true);
  assert.ok(Math.abs((result.aggregate.score ?? 0) - 0.6) < 1e-10);
});

test('grader aggregate WEIGHTED strategy fails below threshold', async () => {
  const result = await aggregateGraders({
    execution: { schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT, output: 'test' },
    layers: [
      { name: 'g1', type: 'a', weight: 1.0 },
      { name: 'g2', type: 'b', weight: 1.0 },
    ],
    strategy: 'WEIGHTED',
    passThreshold: 0.7,
    resolveGrader: () => async () => ({ pass: false, score: 0.3, reason: 'low' }),
  });

  assert.equal(result.aggregate.pass, false);
  assert.ok((result.aggregate.score ?? 0) < 0.7);
});

test('grader aggregate passes immutable isolated config to grader', async () => {
  const originalConfig = {
    nested: {
      flag: true,
    },
  };
  let topLevelMutationBlocked = false;
  let nestedMutationBlocked = false;
  let receivedConfig: Record<string, unknown> | undefined;

  const result = await aggregateGraders({
    execution: { schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT, output: 'test' },
    layers: [
      {
        name: 'immutable-config-check',
        type: 'immutable-config-check',
        config: originalConfig,
      },
    ],
    strategy: 'ALL',
    resolveGrader: () => async (_execution, config) => {
      receivedConfig = config;
      const nested = config.nested as Record<string, unknown>;

      try {
        (config as Record<string, unknown>).newField = 'mutated';
      } catch {
        topLevelMutationBlocked = true;
      }
      try {
        nested.flag = false;
      } catch {
        nestedMutationBlocked = true;
      }

      return { pass: true, reason: 'ok' };
    },
  });

  assert.equal(result.aggregate.pass, true);
  assert.equal(topLevelMutationBlocked, true);
  assert.equal(nestedMutationBlocked, true);
  assert.equal(originalConfig.nested.flag, true);
  assert.ok(receivedConfig);
  assert.equal(Object.isFrozen(receivedConfig), true);
  assert.equal(Object.isFrozen(receivedConfig?.nested as object), true);
});

// --- configHash Tests ---

test('configHash is deterministic for the same experiment', () => {
  const experiment = makeExperiment();
  const hash1 = computeConfigHash(experiment);
  const hash2 = computeConfigHash(experiment);

  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64); // SHA-256 hex length
});

test('configHash changes when maxConcurrency changes', () => {
  const exp1 = makeExperiment({ maxConcurrency: 1 });
  const exp2 = makeExperiment({ maxConcurrency: 5 });

  assert.notEqual(computeConfigHash(exp1), computeConfigHash(exp2));
});

test('configHash ignores experiment name', () => {
  const exp1 = makeExperiment({ name: 'experiment-a' });
  const exp2 = makeExperiment({ name: 'experiment-b' });

  assert.equal(computeConfigHash(exp1), computeConfigHash(exp2));
});

test('configHash changes when run config changes', () => {
  const exp1 = makeExperiment({
    runs: [{ name: 'default', overrides: { alpha: 1 } }],
  });
  const exp2 = makeExperiment({
    runs: [{ name: 'candidate', overrides: { alpha: 1 } }],
  });
  const exp3 = makeExperiment({
    runs: [{ name: 'default', overrides: { alpha: 999 } }],
  });

  assert.notEqual(computeConfigHash(exp1), computeConfigHash(exp2));
  assert.notEqual(computeConfigHash(exp1), computeConfigHash(exp3));
});

test('configHash is stable for semantically equal nested override objects', () => {
  const exp1 = makeExperiment({
    runs: [{ name: 'default', overrides: { nested: { b: 2, a: 1 } } }],
  });
  const exp2 = makeExperiment({
    runs: [{ name: 'default', overrides: { nested: { a: 1, b: 2 } } }],
  });

  assert.equal(computeConfigHash(exp1), computeConfigHash(exp2));
});

// --- Trial Engine / Run Orchestrator Integration Tests ---

test('runExperiment executes a single task with one trial and produces summary', async () => {
  const task = makeTask();
  const { core, resultStore, providerRegistry } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mock-provider', createPassingProvider());

  const experiment = makeExperiment();
  const summary = await (await core.loadExperiment(experiment)).run('default');

  assert.equal(summary.totalTasks, 1);
  assert.equal(summary.totalTrials, 1);
  assert.equal(summary.passRate, 1);

  // Verify manifest was saved
  const manifests = [...resultStore.runManifests.values()];
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0]?.datasetHash, 'test-hash-001');
  assert.equal(manifests[0]?.taskSource.revision, 'rev-001');
});

test('streamRun emits events in correct order', async () => {
  const task = makeTask();
  const { core, providerRegistry } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mock-provider', createPassingProvider());

  const events: RunEvent[] = [];
  for await (const event of (await core.loadExperiment(makeExperiment())).stream('default')) {
    events.push(event);
  }

  assert.equal(events[0]?.type, 'run:started');
  assert.equal(events[events.length - 1]?.type, 'run:completed');

  // Should have: run:started, trial:started, trial:completed, run:completed
  const types = events.map((e) => e.type);
  assert.ok(types.includes('trial:started'));
  assert.ok(types.includes('trial:completed'));
});

test('streamRun handles slow consumers without dropping events', async () => {
  const tasks = Array.from({ length: 40 }, (_, i) => makeTask({ id: `task-${i}` }));
  const { core, providerRegistry } = setupTestCore({ tasks });
  providerRegistry.register('mock-provider', createPassingProvider());

  const events: RunEvent[] = [];
  for await (const event of (await core.loadExperiment(makeExperiment({ maxConcurrency: 4 }))).stream('default')) {
    events.push(event);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  const expectedEventCount = 1 + tasks.length * 2 + 1;
  assert.equal(events.length, expectedEventCount);
  assert.equal(events[0]?.type, 'run:started');
  assert.equal(events[events.length - 1]?.type, 'run:completed');
});

test('streamRun external signal abort interrupts pending next immediately', async () => {
  const task = makeTask({
    execution: { timeoutMs: 5000, trialsPerTask: 2 },
  });
  const { core, providerRegistry } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mock-provider', createNonCooperativeSlowProvider(300));

  const abortController = new AbortController();
  const iterator = (
    await core.loadExperiment(makeExperiment({ maxConcurrency: 1 }))
  ).stream('default', {
    signal: abortController.signal,
  })[Symbol.asyncIterator]();

  while (true) {
    const next = await iterator.next();
    assert.equal(next.done, false);
    if (
      next.value.type === 'trial:started' &&
      next.value.taskId === task.id &&
      next.value.trialIndex === 1
    ) {
      break;
    }
  }

  const startedAt = Date.now();
  const pendingNext = iterator.next();
  abortController.abort(new StreamClosedError());
  const next = await pendingNext;
  const elapsedMs = Date.now() - startedAt;

  assert.ok(
    elapsedMs < 250,
    `Expected pending stream next() to resolve quickly after abort, got ${elapsedMs}ms`,
  );
  assert.equal(next.done, true);
});

test('streamRun early stop aborts workers and still persists consistent run records', async () => {
  const tasks = Array.from({ length: 3 }, (_, i) => makeTask({ id: `task-${i}` }));
  const { core, providerRegistry, resultStore } = setupTestCore({ tasks });
  providerRegistry.register('mock-provider', createSlowProvider(300));

  for await (const event of (await core.loadExperiment(makeExperiment({ maxConcurrency: 2 }))).stream('default')) {
    if (event.type === 'trial:started') {
      break;
    }
  }

  const allTrials = [...resultStore.trialRecords.values()].flat();
  const summaries = [...resultStore.runSummaries.values()];
  const manifests = [...resultStore.runManifests.values()];

  assert.equal(allTrials.length, 0);
  assert.equal(summaries.length, 0);
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0]?.completedAt, undefined);
});

test('streamRun early stop returns quickly when provider ignores AbortSignal', async () => {
  const tasks = [makeTask({ execution: { timeoutMs: 5000 } })];
  const { core, providerRegistry } = setupTestCore({ tasks });
  providerRegistry.register('mock-provider', createNonCooperativeSlowProvider(300));

  const startedAt = Date.now();
  for await (const event of (await core.loadExperiment(makeExperiment({ maxConcurrency: 1 }))).stream(
    'default',
  )) {
    if (event.type === 'trial:started') {
      break;
    }
  }
  const elapsedMs = Date.now() - startedAt;

  assert.ok(
    elapsedMs < 250,
    `Expected stream close to return quickly, got ${elapsedMs}ms`,
  );
});

test('single trial failure does not affect other trials', async () => {
  const task1 = makeTask({ id: 'task-pass' });
  const task2 = makeTask({ id: 'task-fail', provider: { id: 'failing-provider' } });

  const { core, providerRegistry } = setupTestCore({ tasks: [task1, task2] });
  providerRegistry.register('mock-provider', createPassingProvider());
  providerRegistry.register('failing-provider', createFailingProvider());

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');

  assert.equal(summary.totalTasks, 2);
  assert.equal(summary.totalTrials, 2);
  assert.equal(summary.passRate, 0.5);
});

test('agent error is recorded as failure without retry', async () => {
  const task = makeTask({ provider: { id: 'failing-provider' } });
  const { core, providerRegistry, resultStore } = setupTestCore({ tasks: [task] });
  providerRegistry.register('failing-provider', createFailingProvider());

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');

  assert.equal(summary.passRate, 0);

  // Verify trial has error recorded
  const allTrials = [...resultStore.trialRecords.values()].flat();
  assert.equal(allTrials.length, 1);
  assert.equal(allTrials[0]?.trial.execution.error?.type, 'agent');
});

test('run overrides and provider params are deep-frozen before provider execution', async () => {
  const task = makeTask({
    provider: {
      id: 'mutating-provider',
      params: {
        taskNested: {
          flag: true,
        },
      },
    },
  });

  const { core, providerRegistry, resultStore } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mutating-provider', async (ctx, params) => {
    const runNested = ctx.overrides.runNested as Record<string, unknown>;
    const taskNested = params.taskNested as Record<string, unknown>;

    let runTopMutationBlocked = false;
    let runNestedMutationBlocked = false;
    let paramsTopMutationBlocked = false;
    let paramsNestedMutationBlocked = false;

    try {
      (ctx.overrides as Record<string, unknown>).newRunField = 'mutated';
    } catch {
      runTopMutationBlocked = true;
    }
    try {
      runNested.flag = false;
    } catch {
      runNestedMutationBlocked = true;
    }
    try {
      (params as Record<string, unknown>).newParamField = 'mutated';
    } catch {
      paramsTopMutationBlocked = true;
    }
    try {
      taskNested.flag = false;
    } catch {
      paramsNestedMutationBlocked = true;
    }

    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: JSON.stringify({
        runTopMutationBlocked,
        runNestedMutationBlocked,
        paramsTopMutationBlocked,
        paramsNestedMutationBlocked,
        runTopFrozen: Object.isFrozen(ctx.overrides),
        runNestedFrozen: Object.isFrozen(runNested),
        paramsTopFrozen: Object.isFrozen(params),
        paramsNestedFrozen: Object.isFrozen(taskNested),
      }),
    };
  });

  const experiment = makeExperiment({
    runs: [
      {
        name: 'default',
        overrides: {
          runNested: {
            flag: true,
          },
        },
      },
    ],
  });
  const summary = await (await core.loadExperiment(experiment)).run('default');

  assert.equal(summary.passRate, 1);
  const allTrials = [...resultStore.trialRecords.values()].flat();
  const mutationReport = JSON.parse(allTrials[0]?.trial.execution.output ?? '{}') as Record<
    string,
    boolean
  >;

  assert.equal(mutationReport.runTopMutationBlocked, true);
  assert.equal(mutationReport.runNestedMutationBlocked, true);
  assert.equal(mutationReport.paramsTopMutationBlocked, true);
  assert.equal(mutationReport.paramsNestedMutationBlocked, true);
  assert.equal(mutationReport.runTopFrozen, true);
  assert.equal(mutationReport.runNestedFrozen, true);
  assert.equal(mutationReport.paramsTopFrozen, true);
  assert.equal(mutationReport.paramsNestedFrozen, true);
});

test('system error triggers retry per retryOnError config', async () => {
  // Provider fails once (system error), then succeeds
  const task = makeTask({
    execution: { timeoutMs: 5000, retryOnError: 2 },
  });

  const { core, providerRegistry, graderRegistry } = setupTestCore({ tasks: [task] });

  // Provider that throws (system error) once, then succeeds
  let callCount = 0;
  providerRegistry.register('mock-provider', async () => {
    callCount++;
    if (callCount <= 1) {
      throw new Error('transient failure');
    }
    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: 'recovered',
    };
  });

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');

  // After retry, the trial should pass
  assert.equal(summary.passRate, 1);
  assert.ok(callCount >= 2);
});

test('timeout system error is never retried even when retryable is true', async () => {
  const task = makeTask({
    execution: { timeoutMs: 5000, retryOnError: 3 },
  });

  const { core, providerRegistry, resultStore } = setupTestCore({ tasks: [task] });
  let callCount = 0;
  providerRegistry.register('mock-provider', async () => {
    callCount++;
    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: '',
      error: {
        type: 'system',
        code: SYSTEM_ERROR_CODES.TIMEOUT,
        message: 'provider marked timeout',
        retryable: true,
      },
    };
  });

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');
  const allTrials = [...resultStore.trialRecords.values()].flat();

  assert.equal(summary.passRate, 0);
  assert.equal(allTrials.length, 1);
  assert.equal(allTrials[0]?.trial.execution.error?.code, SYSTEM_ERROR_CODES.TIMEOUT);
  assert.equal(callCount, 1);
});

test('timeout aborts provider execution and records system error', async () => {
  const task = makeTask({
    execution: { timeoutMs: 50 }, // Very short timeout
  });

  const { core, providerRegistry, resultStore } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mock-provider', createSlowProvider(5000)); // Takes 5s

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');

  assert.equal(summary.passRate, 0);

  const allTrials = [...resultStore.trialRecords.values()].flat();
  assert.equal(allTrials[0]?.trial.execution.error?.type, 'system');
  assert.equal(allTrials[0]?.trial.execution.error?.code, SYSTEM_ERROR_CODES.TIMEOUT);
  assert.equal(allTrials[0]?.trial.execution.error?.retryable, false);
});

test('multiple trials per task computes pass@k and pass^k', async () => {
  const task = makeTask({
    graders: {
      strategy: 'ALL',
      layers: [{ name: 'output-check', type: 'output-check' }],
    },
  });

  const graderRegistry = new InMemoryGraderRegistry();
  // Grader passes only when output is 'pass'
  graderRegistry.register('output-check', async (result) => ({
    pass: result.output === 'pass',
    reason: result.output === 'pass' ? 'ok' : 'fail',
  }));

  const providerRegistry = new InMemoryProviderRegistry();
  // Provider alternates pass/fail
  let callCount = 0;
  providerRegistry.register('mock-provider', async () => {
    callCount++;
    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: callCount % 2 === 1 ? 'pass' : 'fail',
    };
  });

  const { core } = setupTestCore({ tasks: [task], providerRegistry, graderRegistry });

  const experiment = makeExperiment({ trialsPerTask: 3, maxConcurrency: 1 });
  const summary = await (await core.loadExperiment(experiment)).run('default');

  assert.equal(summary.totalTrials, 3);
  // At least 1 trial passes (trial 1 and 3), so passRate = 1 (pass@k)
  assert.equal(summary.passRate, 1);
  // passAtK should be 1 (at least 1 of 3 passed)
  assert.equal(summary.passAtK, 1);
  // passHatK should be 0 (not all 3 passed)
  assert.equal(summary.passHatK, 0);
});

test('concurrent execution respects maxConcurrency', async () => {
  const tasks = Array.from({ length: 4 }, (_, i) => makeTask({ id: `task-${i}` }));

  let peakConcurrency = 0;
  let currentConcurrency = 0;

  const { core, providerRegistry } = setupTestCore({ tasks });
  providerRegistry.register('mock-provider', async () => {
    currentConcurrency++;
    peakConcurrency = Math.max(peakConcurrency, currentConcurrency);
    await new Promise((resolve) => setTimeout(resolve, 20));
    currentConcurrency--;
    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: 'ok',
    };
  });

  const experiment = makeExperiment({ maxConcurrency: 2 });
  await (await core.loadExperiment(experiment)).run('default');

  assert.ok(peakConcurrency <= 2, `Peak concurrency ${peakConcurrency} exceeded maxConcurrency 2`);
});

test('observer receives all events and failures do not affect pass/fail', async () => {
  const task = makeTask();
  const observerEvents: RunEvent[] = [];
  let observerFailCount = 0;

  const resultStore = new InMemoryResultStoreAdapter();
  const providerRegistry = new InMemoryProviderRegistry();
  const graderRegistry = new InMemoryGraderRegistry();
  graderRegistry.register('always-pass', async () => ({ pass: true, reason: 'ok' }));
  providerRegistry.register('mock-provider', createPassingProvider());

  // Observer that throws on first call
  const failingObserver: ObserverAdapter = {
    onEvent(event) {
      observerEvents.push(event);
      observerFailCount++;
      if (observerFailCount <= 1) {
        throw new Error('observer failure');
      }
    },
  };

  const core = createCore({
    taskSourceAdapter: createMockTaskSource([task]),
    resultStoreAdapter: resultStore,
    observerAdapters: [failingObserver],
    providerRegistry,
    graderRegistry,
  });

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');

  // Despite observer failure, run should complete
  assert.equal(summary.passRate, 1);
  // Observer should have received events
  assert.ok(observerEvents.length > 0);
});

test('hanging observer does not block run completion', async () => {
  const task = makeTask();
  const observerEvents: RunEvent[] = [];

  const resultStore = new InMemoryResultStoreAdapter();
  const providerRegistry = new InMemoryProviderRegistry();
  const graderRegistry = new InMemoryGraderRegistry();
  graderRegistry.register('always-pass', async () => ({ pass: true, reason: 'ok' }));
  providerRegistry.register('mock-provider', createPassingProvider());

  const hangingObserver: ObserverAdapter = {
    onEvent() {
      return new Promise<void>(() => {});
    },
  };
  const recordingObserver: ObserverAdapter = {
    onEvent(event) {
      observerEvents.push(event);
    },
  };

  const core = createCore({
    taskSourceAdapter: createMockTaskSource([task]),
    resultStoreAdapter: resultStore,
    observerAdapters: [hangingObserver, recordingObserver],
    providerRegistry,
    graderRegistry,
  });

  const executionResult = await Promise.race([
    (await core.loadExperiment(makeExperiment())).run('default')
      .then(() => 'resolved')
      .catch(() => 'rejected'),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 1500);
    }),
  ]);

  assert.equal(executionResult, 'resolved');
  assert.ok(observerEvents.length > 0);
});

test('observer notify clears timeout when observer returns early', async () => {
  const task = makeTask();
  const resultStore = new InMemoryResultStoreAdapter();
  const providerRegistry = new InMemoryProviderRegistry();
  const graderRegistry = new InMemoryGraderRegistry();
  graderRegistry.register('always-pass', async () => ({ pass: true, reason: 'ok' }));
  providerRegistry.register('mock-provider', createPassingProvider());

  const quickObserver: ObserverAdapter = {
    onEvent() {
      return;
    },
  };

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();
  let scheduledTimeouts = 0;
  let clearedTimeouts = 0;

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    scheduledTimeouts++;
    let timeoutId: ReturnType<typeof setTimeout>;

    timeoutId = originalSetTimeout(
      (...innerArgs: unknown[]) => {
        activeTimeouts.delete(timeoutId);
        if (typeof handler === 'function') {
          handler(...innerArgs);
        }
      },
      timeout,
      ...args,
    );
    activeTimeouts.add(timeoutId);
    return timeoutId;
  }) as unknown as typeof setTimeout;

  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout> | undefined) => {
    if (id !== undefined && activeTimeouts.delete(id)) {
      clearedTimeouts++;
    }
    return originalClearTimeout(id);
  }) as typeof clearTimeout;

  try {
    const core = createCore({
      taskSourceAdapter: createMockTaskSource([task]),
      resultStoreAdapter: resultStore,
      observerAdapters: [quickObserver],
      providerRegistry,
      graderRegistry,
    });

    await (await core.loadExperiment(makeExperiment())).run('default');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.ok(scheduledTimeouts >= 4);
  assert.ok(clearedTimeouts >= 4);
  assert.equal(activeTimeouts.size, 0);
});

test('run manifest includes correct taskSource and datasetHash', async () => {
  const task = makeTask();
  const { core, resultStore, providerRegistry } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mock-provider', createPassingProvider());

  await (await core.loadExperiment(makeExperiment())).run('default');

  const manifests = [...resultStore.runManifests.values()];
  assert.equal(manifests.length, 1);
  const manifest = manifests[0]!;

  assert.equal(manifest.schemaVersion, 'run-manifest.v1');
  assert.equal(manifest.taskSource.adapter, 'local');
  assert.equal(manifest.taskSource.ref, 'dataset://test');
  assert.equal(manifest.taskSource.revision, 'rev-001');
  assert.equal(manifest.datasetHash, 'test-hash-001');
  assert.ok(manifest.configHash.length === 64);
  assert.ok(manifest.startedAt);
  assert.ok(manifest.completedAt);
});

test('avgLatencyMs is computed from execution metrics', async () => {
  const tasks = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })];
  const { core, providerRegistry } = setupTestCore({ tasks });

  let callCount = 0;
  providerRegistry.register('mock-provider', async () => {
    callCount++;
    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: 'ok',
      metrics: { latencyMs: callCount * 100 },
    };
  });

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');

  // avgLatencyMs should be (100 + 200) / 2 = 150
  assert.equal(summary.avgLatencyMs, 150);
});

test('dataset resolve failure terminates run before trial execution', async () => {
  const failingTaskSource: TaskSourceAdapter = {
    async resolveDataset(_selector): Promise<ResolvedDataset> {
      throw new Error('dataset not found');
    },
  };

  const core = createCore({
    taskSourceAdapter: failingTaskSource,
    resultStoreAdapter: new InMemoryResultStoreAdapter(),
    providerRegistry: new InMemoryProviderRegistry(),
    graderRegistry: new InMemoryGraderRegistry(),
  });

  await assert.rejects(
    async () => (await core.loadExperiment(makeExperiment())).run('default'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('dataset not found'));
      return true;
    },
  );
});

test('run fails fast before execution when regex grader config is invalid', async () => {
  const task = makeTask({
    graders: {
      strategy: 'ALL',
      layers: [
        {
          name: 'regex-invalid',
          type: 'regex',
          config: {
            mustMatch: [{ pattern: '[' }],
          },
        },
      ],
    },
  });

  const resultStore = new InMemoryResultStoreAdapter();
  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('mock-provider', createPassingProvider());
  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  const core = createCore({
    taskSourceAdapter: createMockTaskSource([task]),
    resultStoreAdapter: resultStore,
    providerRegistry,
    graderRegistry,
  });

  await assert.rejects(
    async () => (await core.loadExperiment(makeExperiment())).run('default'),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes("Invalid config for grader 'regex'"));
      assert.ok(error.message.includes("task 'test-task-1'"));
      return true;
    },
  );

  assert.equal(resultStore.runManifests.size, 0);
  assert.equal(resultStore.trialRecords.size, 0);
});

test('run fails fast before execution when json-schema grader pattern is invalid', async () => {
  const task = makeTask({
    graders: {
      strategy: 'ALL',
      layers: [
        {
          name: 'json-schema-invalid',
          type: 'json-schema',
          config: {
            schema: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  pattern: '[',
                },
              },
            },
          },
        },
      ],
    },
  });

  const resultStore = new InMemoryResultStoreAdapter();
  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('mock-provider', createPassingProvider());
  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  const core = createCore({
    taskSourceAdapter: createMockTaskSource([task]),
    resultStoreAdapter: resultStore,
    providerRegistry,
    graderRegistry,
  });

  await assert.rejects(
    async () => (await core.loadExperiment(makeExperiment())).run('default'),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes("Invalid config for grader 'json-schema'"));
      assert.ok(error.message.includes('Invalid JSON Schema'));
      return true;
    },
  );

  assert.equal(resultStore.runManifests.size, 0);
  assert.equal(resultStore.trialRecords.size, 0);
});

test("run does not fail fast when json-schema has a property named 'pattern'", async () => {
  const task = makeTask({
    graders: {
      strategy: 'ALL',
      layers: [
        {
          name: 'json-schema-pattern-property',
          type: 'json-schema',
          config: {
            schema: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
                },
              },
              required: ['pattern'],
            },
          },
        },
      ],
    },
  });

  const resultStore = new InMemoryResultStoreAdapter();
  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('mock-provider', async () => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: 'ok',
    structuredOutput: { pattern: 'hello' },
  }));
  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  const core = createCore({
    taskSourceAdapter: createMockTaskSource([task]),
    resultStoreAdapter: resultStore,
    providerRegistry,
    graderRegistry,
  });

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');
  assert.equal(summary.totalTrials, 1);
  assert.equal(summary.passRate, 1);
  assert.equal(resultStore.trialRecords.size, 1);
});

test('run fails fast before execution when length-check min is greater than max', async () => {
  const task = makeTask({
    graders: {
      strategy: 'ALL',
      layers: [
        {
          name: 'length-check-invalid',
          type: 'length-check',
          config: {
            min: 10,
            max: 5,
          },
        },
      ],
    },
  });

  const resultStore = new InMemoryResultStoreAdapter();
  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('mock-provider', createPassingProvider());
  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  const core = createCore({
    taskSourceAdapter: createMockTaskSource([task]),
    resultStoreAdapter: resultStore,
    providerRegistry,
    graderRegistry,
  });

  await assert.rejects(
    async () => (await core.loadExperiment(makeExperiment())).run('default'),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes("Invalid config for grader 'length-check'"));
      assert.ok(error.message.includes("Field 'min' must be less than or equal to 'max'."));
      return true;
    },
  );

  assert.equal(resultStore.runManifests.size, 0);
  assert.equal(resultStore.trialRecords.size, 0);
});

test('orchestrateRun throws validation error when runName is not defined', async () => {
  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('mock-provider', createPassingProvider());

  const graderRegistry = new InMemoryGraderRegistry();
  graderRegistry.register('always-pass', async () => ({ pass: true, reason: 'ok' }));

  const experiment = makeExperiment({ runs: [{ name: 'default' }] });

  await assert.rejects(
    async () => {
      for await (const _event of orchestrateRun(
        { experiment, runName: 'unknown-run' },
        {
          taskSourceAdapter: createMockTaskSource([makeTask()]),
          resultStoreAdapter: new InMemoryResultStoreAdapter(),
          observerAdapters: [],
          providerRegistry,
          graderRegistry,
        },
      )) {
      }
    },
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('unknown-run'));
      return true;
    },
  );
});

test('experiment-level timeoutMs overrides task-level timeoutMs', async () => {
  const task = makeTask({
    execution: { timeoutMs: 60000 }, // Task says 60s
  });

  const { core, providerRegistry, resultStore } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mock-provider', createSlowProvider(5000));

  // Experiment-level timeout is 50ms — should override the 60s task-level
  const experiment = makeExperiment({ timeoutMs: 50 });
  const summary = await (await core.loadExperiment(experiment)).run('default');

  assert.equal(summary.passRate, 0);
  const allTrials = [...resultStore.trialRecords.values()].flat();
  assert.equal(allTrials[0]?.trial.execution.error?.type, 'system');
});

test('timeout is enforced even when provider ignores AbortSignal', async () => {
  const task = makeTask({
    execution: { timeoutMs: 50, retryOnError: 3 },
  });

  let callCount = 0;
  const nonCooperativeProvider = createNonCooperativeSlowProvider(300);
  const { core, providerRegistry, resultStore } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mock-provider', async () => {
    callCount++;
    return nonCooperativeProvider();
  });

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');
  const allTrials = [...resultStore.trialRecords.values()].flat();

  assert.equal(summary.passRate, 0);
  assert.equal(allTrials.length, 1);
  assert.equal(allTrials[0]?.trial.execution.error?.type, 'system');
  assert.equal(allTrials[0]?.trial.execution.error?.code, SYSTEM_ERROR_CODES.TIMEOUT);
  assert.equal(allTrials[0]?.trial.execution.error?.retryable, false);
  assert.ok((allTrials[0]?.trial.execution.error?.message ?? '').includes('timed out'));
  assert.equal(callCount, 1);
});

test('grader exception is contained as trial system failure and does not abort run', async () => {
  const throwingGraders = {
    strategy: 'ALL' as const,
    layers: [{ name: 'throwing', type: 'throwing-grader' }],
  };
  const task1 = makeTask({ id: 'task-grader-throws', graders: throwingGraders });
  const task2 = makeTask({ id: 'task-still-runs', graders: throwingGraders });

  const { core, providerRegistry, graderRegistry, resultStore } = setupTestCore({
    tasks: [task1, task2],
  });

  providerRegistry.register('mock-provider', createPassingProvider());
  graderRegistry.register('throwing-grader', async () => {
    throw new Error('grader exploded');
  });

  const summary = await (await core.loadExperiment(makeExperiment({ maxConcurrency: 2 }))).run('default');

  const allTrials = [...resultStore.trialRecords.values()].flat();
  assert.equal(summary.totalTrials, 2);
  assert.equal(summary.passRate, 0);
  assert.equal(allTrials.length, 2);
  assert.ok(allTrials.every((record) => record.trial.execution.error?.type === 'system'));
  assert.ok(
    allTrials.every(
      (record) =>
        record.trial.execution.error?.code === SYSTEM_ERROR_CODES.GRADER_EXCEPTION &&
        record.trial.execution.error?.retryable === true,
    ),
  );
});

test('trial results are persisted to ResultStoreAdapter', async () => {
  const task = makeTask();
  const { core, resultStore, providerRegistry } = setupTestCore({ tasks: [task] });
  providerRegistry.register('mock-provider', createPassingProvider());

  const summary = await (await core.loadExperiment(makeExperiment())).run('default');

  // Verify trials are stored
  const trials = [...resultStore.trialRecords.values()].flat();
  assert.equal(trials.length, 1);
  assert.equal(trials[0]?.trial.taskId, 'test-task-1');
  assert.equal(trials[0]?.trial.aggregate.pass, true);
  assert.equal(trials[0]?.trial.schemaVersion, 'trial-result.v1');

  // Verify summary is stored
  const storedSummary = [...resultStore.runSummaries.values()];
  assert.equal(storedSummary.length, 1);
  assert.equal(storedSummary[0]?.summary.runId, summary.runId);
});

test('runExperiment surfaces trial persistence errors without hanging', async () => {
  class SaveTrialFailingResultStore extends InMemoryResultStoreAdapter {
    override async saveTrial(): Promise<void> {
      throw new Error('save trial failed');
    }
  }

  const task = makeTask();
  const { core, providerRegistry } = setupTestCore({
    tasks: [task],
    resultStore: new SaveTrialFailingResultStore(),
  });
  providerRegistry.register('mock-provider', createPassingProvider());

  const result = await Promise.race([
    core.loadExperiment(makeExperiment())
      .then((loaded) => loaded.run('default'))
      .then(() => 'resolved')
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
    new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 1000)),
  ]);

  assert.equal(result, 'save trial failed');
});

test('streamRun does not treat worker Error(\'stream closed\') as user cancellation', async () => {
  class SaveTrialCollisionMessageResultStore extends InMemoryResultStoreAdapter {
    override async saveTrial(): Promise<void> {
      throw new Error('stream closed');
    }
  }

  const task = makeTask();
  const { core, providerRegistry } = setupTestCore({
    tasks: [task],
    resultStore: new SaveTrialCollisionMessageResultStore(),
  });
  providerRegistry.register('mock-provider', createPassingProvider());

  await assert.rejects(
    async () => {
      for await (const _event of (await core.loadExperiment(makeExperiment())).stream('default')) {
        // consume until stream ends or rejects
      }
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'stream closed');
      assert.notEqual(error.name, 'StreamClosedError');
      return true;
    },
  );
});

test('runExperiment waits for in-flight workers to settle before rejecting on worker fatal error', async () => {
  class FlakySaveResultStore extends InMemoryResultStoreAdapter {
    private failed = false;

    override async saveTrial(input: TrialResultRecord): Promise<void> {
      if (!this.failed && input.trial.taskId === 'task-fast') {
        this.failed = true;
        throw new Error('save trial failed');
      }

      await super.saveTrial(input);
    }
  }

  const tasks = [
    makeTask({ id: 'task-fast', provider: { id: 'fast-provider' } }),
    makeTask({ id: 'task-slow', provider: { id: 'slow-provider' } }),
  ];

  let slowProviderInFlight = 0;
  const { core, providerRegistry } = setupTestCore({
    tasks,
    resultStore: new FlakySaveResultStore(),
  });

  providerRegistry.register('fast-provider', async () => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: 'fast',
  }));
  providerRegistry.register('slow-provider', async () => {
    slowProviderInFlight++;
    try {
      return await createNonCooperativeSlowProvider(200)();
    } finally {
      slowProviderInFlight--;
    }
  });

  const startedAt = Date.now();
  await assert.rejects(
    async () =>
      (await core.loadExperiment(makeExperiment({ maxConcurrency: 2 }))).run('default'),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'save trial failed');
      return true;
    },
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(slowProviderInFlight, 0);
  assert.ok(
    elapsedMs >= 180,
    `Expected orchestrator to wait for in-flight worker, got ${elapsedMs}ms`,
  );
});
