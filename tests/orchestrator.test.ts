import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BaselineRecord,
  ClearedResultEntry,
  ResultStoreAdapter,
} from '../src/core/adapters/result-store-adapter.js';
import type { ResolvedTask } from '../src/core/adapters/task-source-adapter.js';
import type { ExecutionResult } from '../src/core/contracts/execution.js';
import { SCHEMA_VERSIONS } from '../src/core/contracts/index.js';
import type { RunManifest } from '../src/core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../src/core/contracts/run-summary.js';
import type { RunEvent, SuiteDefinition } from '../src/core/contracts/runtime.js';
import type { TaskDefinition } from '../src/core/contracts/task.js';
import type { TrialResultRecord } from '../src/core/contracts/trial.js';
import {
  orchestrateTaskRun,
} from '../src/core/orchestrator/run-orchestrator.js';
import { getEffectiveExecution } from '../src/core/runtime/effective-execution.js';
import { InMemoryGraderRegistry, InMemoryProviderRegistry } from '../src/core/runtime/index.js';
import { computeSha256 } from '../src/core/utils/hash.js';

class InMemoryResultStoreAdapter implements ResultStoreAdapter {
  readonly runManifests = new Map<string, RunManifest>();
  readonly runSummaries = new Map<string, RunSummaryRecord>();
  readonly trialRecords = new Map<string, TrialResultRecord[]>();

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
  async saveBaseline(_input: BaselineRecord): Promise<void> {}
  async getBaselineRunId(): Promise<string | null> {
    return null;
  }
  async listRunIds(): Promise<string[]> {
    return [...this.runSummaries.keys()].sort();
  }
  async clearResultsByRunIds(_runIds: string[]): Promise<ClearedResultEntry[]> {
    return [];
  }
  async clearAllResults(): Promise<ClearedResultEntry[]> {
    return [];
  }
}

function createSuite(): SuiteDefinition {
  return {
    schemaVersion: SCHEMA_VERSIONS.SUITE,
    id: 'basic-llm',
    name: 'Basic LLM',
    discover: ['datasets/**/*.yaml'],
  };
}

function createTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    schemaVersion: SCHEMA_VERSIONS.TASK,
    id: 'basic-llm/task-001',
    provider: {
      id: 'mock-provider',
      runs: [
        {
          name: 'mini',
          params: {
            prompt: 'hello',
            nested: { flag: true },
          },
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
      maxConcurrency: 2,
    },
    ...overrides,
  };
}

function createResolvedTask(task: TaskDefinition): ResolvedTask {
  return {
    source: {
      adapter: 'memory',
      ref: 'datasets/task-001.yaml',
      revision: 'sha256-task-001',
      fetchedAt: '2026-03-05T00:00:00.000Z',
    },
    task,
  };
}

function createDeps(resultStore = new InMemoryResultStoreAdapter()) {
  const providerRegistry = new InMemoryProviderRegistry();
  const graderRegistry = new InMemoryGraderRegistry();
  graderRegistry.register('always-pass', async () => ({ pass: true, reason: 'ok' }));

  return {
    deps: {
      resultStoreAdapter: resultStore,
      observerAdapters: [],
      providerRegistry,
      graderRegistry,
      runtimeDefaults: {
        maxConcurrency: 5,
      },
    },
    providerRegistry,
    resultStore,
  };
}

async function collectEvents(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const results: RunEvent[] = [];
  for await (const event of events) {
    results.push(event);
  }
  return results;
}

test('configHash is deterministic and changes on run params/execution changes', () => {
  const baseTask = createTask();
  const run = baseTask.provider.runs[0]!;
  const execution = getEffectiveExecution(baseTask, { maxConcurrency: 5 });

  const hash1 = computeSha256({
    taskId: baseTask.id,
    providerId: baseTask.provider.id,
    run: {
      name: run.name,
      params: run.params,
    },
    execution,
  });
  const hash2 = computeSha256({
    taskId: baseTask.id,
    providerId: baseTask.provider.id,
    run: {
      name: run.name,
      params: run.params,
    },
    execution,
  });
  const hashWithDifferentParams = computeSha256({
    taskId: baseTask.id,
    providerId: baseTask.provider.id,
    run: {
      name: run.name,
      params: {
        prompt: 'changed',
      },
    },
    execution,
  });

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hashWithDifferentParams);
});

test('orchestrateTaskRun persists manifest, trials, and summary for one task run', async () => {
  const { deps, providerRegistry, resultStore } = createDeps();
  providerRegistry.register('mock-provider', async (_ctx, params) => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: String(params.prompt ?? ''),
    metrics: { latencyMs: 50 },
  }));

  const task = createTask();
  const run = task.provider.runs[0]!;
  const events = await collectEvents(
    orchestrateTaskRun(
      {
        suite: createSuite(),
        resolvedTask: createResolvedTask(task),
        run,
        execution: getEffectiveExecution(task, deps.runtimeDefaults),
      },
      deps,
    ),
  );

  assert.equal(events[0]?.type, 'run:started');
  assert.equal(events.at(-1)?.type, 'run:completed');

  const [manifest] = [...resultStore.runManifests.values()];
  const [summaryRecord] = [...resultStore.runSummaries.values()];

  assert.equal(manifest?.suiteId, 'basic-llm');
  assert.equal(manifest?.taskId, 'basic-llm/task-001');
  assert.equal(manifest?.runName, 'mini');
  assert.equal(manifest?.taskHash, computeSha256(task));
  assert.equal(
    manifest?.configHash,
    computeSha256({
      taskId: task.id,
      providerId: task.provider.id,
      run: {
        name: run.name,
        params: run.params,
      },
      execution: getEffectiveExecution(task, deps.runtimeDefaults),
    }),
  );
  assert.equal(summaryRecord?.summary.taskId, 'basic-llm/task-001');
  assert.equal(summaryRecord?.summary.totalTrials, 2);
  assert.equal(summaryRecord?.summary.passRate, 1);
  assert.equal(resultStore.trialRecords.size, 1);
});

test('orchestrateTaskRun computes passRate as passedTrials divided by totalTrials', async () => {
  const { deps, providerRegistry, resultStore } = createDeps();

  providerRegistry.register('mock-provider', async (ctx) => ({
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: ctx.trialIndex === 0 ? 'ok' : 'fail',
  }));

  const task = createTask({
    execution: {
      timeoutMs: 1000,
      retryOnError: 0,
      trialsPerTask: 2,
      maxConcurrency: 1,
    },
    graders: {
      strategy: 'ALL',
      layers: [
        {
          name: 'pass-when-ok',
          type: 'pass-when-ok',
        },
      ],
    },
  });

  deps.graderRegistry.register('pass-when-ok', async (execution) => ({
    pass: execution.output === 'ok',
  }));

  await collectEvents(
    orchestrateTaskRun(
      {
        suite: createSuite(),
        resolvedTask: createResolvedTask(task),
        run: task.provider.runs[0]!,
        execution: getEffectiveExecution(task, deps.runtimeDefaults),
      },
      deps,
    ),
  );

  const [summaryRecord] = [...resultStore.runSummaries.values()];
  assert.equal(summaryRecord?.summary.passRate, 0.5);
  assert.equal(summaryRecord?.summary.passAtK, 1);
  assert.equal(summaryRecord?.summary.passHatK, 0);
});

test('orchestrateTaskRun respects task.execution.maxConcurrency for trials', async () => {
  const { deps, providerRegistry } = createDeps();
  let active = 0;
  let peak = 0;

  providerRegistry.register('mock-provider', async (_ctx, _params): Promise<ExecutionResult> => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: 'ok',
    };
  });

  const task = createTask({
    execution: {
      timeoutMs: 1000,
      retryOnError: 0,
      trialsPerTask: 4,
      maxConcurrency: 2,
    },
  });

  await collectEvents(
    orchestrateTaskRun(
      {
        suite: createSuite(),
        resolvedTask: createResolvedTask(task),
        run: task.provider.runs[0]!,
        execution: getEffectiveExecution(task, deps.runtimeDefaults),
      },
      deps,
    ),
  );

  assert.equal(peak, 2);
});

test('orchestrateTaskRun deep-freezes selected run params before provider execution', async () => {
  const { deps, providerRegistry } = createDeps();
  let seenTopFrozen = false;
  let seenNestedFrozen = false;

  providerRegistry.register('mock-provider', async (_ctx, params) => {
    seenTopFrozen = Object.isFrozen(params);
    seenNestedFrozen = Object.isFrozen(params.nested as Record<string, unknown>);
    assert.throws(() => {
      (params as Record<string, unknown>).newField = 'mutated';
    });

    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: 'ok',
    };
  });

  const task = createTask();
  await collectEvents(
    orchestrateTaskRun(
      {
        suite: createSuite(),
        resolvedTask: createResolvedTask(task),
        run: task.provider.runs[0]!,
        execution: getEffectiveExecution(task, deps.runtimeDefaults),
      },
      deps,
    ),
  );

  assert.equal(seenTopFrozen, true);
  assert.equal(seenNestedFrozen, true);
});
