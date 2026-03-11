import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BaselineRecord,
  ClearedResultEntry,
  Stores,
} from '../src/core/adapters/result-store-adapter.js';
import type { ExecutionResult } from '../src/core/contracts/execution.js';
import { SCHEMA_VERSIONS } from '../src/core/contracts/index.js';
import type { RunManifestRecord } from '../src/core/contracts/run-manifest.js';
import type { RunEvent } from '../src/core/contracts/runtime.js';
import type { RunSummaryRecord } from '../src/core/contracts/run-summary.js';
import { Suite } from '../src/core/domain/suite.js';
import { Task } from '../src/core/domain/task.js';
import type { Trial } from '../src/core/domain/trial.js';
import { TaskRunOrchestrator } from '../src/core/orchestrator/run-orchestrator.js';
import { Graders, Providers } from '../src/core/runtime/index.js';
import { resolveExecutionPolicy } from '../src/core/runtime/task-execution.js';
import { computeSha256 } from '../src/core/utils/hash.js';

class InMemoryStore implements Stores {
  readonly runManifests = new Map<string, RunManifestRecord>();
  readonly runSummaries = new Map<string, RunSummaryRecord>();
  readonly trialRecords = new Map<string, { runId: string; trial: Trial['trial'] }[]>();

  async saveRunManifest(input: RunManifestRecord): Promise<void> {
    this.runManifests.set(input.runId, input);
  }
  async saveRunSummary(input: RunSummaryRecord): Promise<void> {
    this.runSummaries.set(input.runId, input);
  }
  async saveTrial(input: { runId: string; trial: Trial['trial'] }): Promise<void> {
    const current = this.trialRecords.get(input.runId) ?? [];
    current.push(input);
    this.trialRecords.set(input.runId, current);
  }
  async getRunManifest(runId: string): Promise<RunManifestRecord | null> {
    return this.runManifests.get(runId) ?? null;
  }
  async getRunSummary(runId: string): Promise<RunSummaryRecord | null> {
    return this.runSummaries.get(runId) ?? null;
  }
  async listTrials(runId: string): Promise<{ runId: string; trial: Trial['trial'] }[]> {
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

function createSuite(): Suite {
  return Suite.fromDocument({
    schemaVersion: SCHEMA_VERSIONS.SUITE,
    id: 'basic-llm',
    name: 'Basic LLM',
    discover: ['datasets/**/*.yaml'],
  });
}

function createTask(overrides: Partial<ReturnType<Task['toDocument']>> = {}): Task {
  return Task.fromDocument(
    {
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
    } as ReturnType<Task['toDocument']>,
    {
      adapter: 'memory',
      ref: 'datasets/task-001.yaml',
      revision: 'sha256-task-001',
      fetchedAt: '2026-03-05T00:00:00.000Z',
    },
  );
}

function createDeps(stores = new InMemoryStore()) {
  const providers = new Providers();
  const graders = new Graders();
  graders.register({
    type: 'always-pass',
    async grade() {
      return { pass: true, reason: 'ok' };
    },
  });

  return {
    deps: {
      stores,
      observers: [],
      providers,
      graders,
    },
    providers,
    graders,
    stores,
    runtimeDefaults: {
      maxConcurrency: 5,
    },
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
  const run = baseTask.runs[0]!;
  const execution = resolveExecutionPolicy(baseTask, { maxConcurrency: 5 });

  const hash1 = computeSha256({
    taskId: baseTask.id,
    providerId: baseTask.providerId,
    run: run.toDocument(),
    execution,
  });
  const hash2 = computeSha256({
    taskId: baseTask.id,
    providerId: baseTask.providerId,
    run: run.toDocument(),
    execution,
  });
  const hashWithDifferentParams = computeSha256({
    taskId: baseTask.id,
    providerId: baseTask.providerId,
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

test('TaskRunOrchestrator persists manifest, trials, and summary for one task run', async () => {
  const { deps, providers, stores, runtimeDefaults } = createDeps();
  providers.register({
    id: 'mock-provider',
    async execute(_ctx, run): Promise<ExecutionResult> {
      return {
        output: String(run.params.prompt ?? ''),
        metrics: { latencyMs: 50 },
      };
    },
  });

  const task = createTask();
  const run = task.runs[0]!;
  const events = await collectEvents(
    new TaskRunOrchestrator(
      {
        suite: createSuite(),
        task,
        run,
        execution: resolveExecutionPolicy(task, runtimeDefaults),
      },
      deps,
    ).run(),
  );

  assert.equal(events[0]?.type, 'run:started');
  assert.equal(events.at(-1)?.type, 'run:completed');

  const [manifest] = [...stores.runManifests.values()];
  const [summaryRecord] = [...stores.runSummaries.values()];

  assert.equal(manifest?.suiteId, 'basic-llm');
  assert.equal(manifest?.taskId, 'basic-llm/task-001');
  assert.equal(manifest?.runName, 'mini');
  assert.equal(manifest?.taskHash, computeSha256(task.toDocument()));
  assert.equal(
    manifest?.configHash,
    computeSha256({
      taskId: task.id,
      providerId: task.providerId,
      run: run.toDocument(),
      execution: resolveExecutionPolicy(task, runtimeDefaults),
    }),
  );
  assert.equal(summaryRecord?.summary.taskId, 'basic-llm/task-001');
  assert.equal(summaryRecord?.summary.totalTrials, 2);
  assert.equal(summaryRecord?.summary.passRate, 1);
  assert.equal(stores.trialRecords.size, 1);
});

test('TaskRunOrchestrator computes passRate as passedTrials divided by totalTrials', async () => {
  const { deps, providers, graders, stores, runtimeDefaults } = createDeps();

  providers.register({
    id: 'mock-provider',
    async execute(ctx): Promise<ExecutionResult> {
      return {
        output: ctx.trialIndex === 0 ? 'ok' : 'fail',
      };
    },
  });

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

  graders.register({
    type: 'pass-when-ok',
    async grade(execution) {
      return {
        pass: execution.output === 'ok',
        reason: execution.output,
      };
    },
  });

  await collectEvents(
    new TaskRunOrchestrator(
      {
        suite: createSuite(),
        task,
        run: task.runs[0]!,
        execution: resolveExecutionPolicy(task, runtimeDefaults),
      },
      deps,
    ).run(),
  );

  const [summaryRecord] = [...stores.runSummaries.values()];
  assert.equal(summaryRecord?.summary.passRate, 0.5);
  assert.equal(summaryRecord?.summary.passAtK, 1);
  assert.equal(summaryRecord?.summary.passHatK, 0);
});

test('TaskRunOrchestrator respects task.execution.maxConcurrency for trials', async () => {
  const { deps, providers, runtimeDefaults } = createDeps();
  let active = 0;
  let peak = 0;

  providers.register({
    id: 'mock-provider',
    async execute(): Promise<ExecutionResult> {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        output: 'ok',
      };
    },
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
    new TaskRunOrchestrator(
      {
        suite: createSuite(),
        task,
        run: task.runs[0]!,
        execution: resolveExecutionPolicy(task, runtimeDefaults),
      },
      deps,
    ).run(),
  );

  assert.equal(peak, 2);
});

test('Run params stay frozen before provider execution', async () => {
  const { deps, providers, runtimeDefaults } = createDeps();
  let seenTopFrozen = false;
  let seenNestedFrozen = false;

  providers.register({
    id: 'mock-provider',
    async execute(_ctx, run): Promise<ExecutionResult> {
      seenTopFrozen = Object.isFrozen(run.params);
      seenNestedFrozen = Object.isFrozen(run.params.nested as Record<string, unknown>);
      assert.throws(() => {
        (run.params as Record<string, unknown>).newField = 'mutated';
      });

      return {
        output: 'ok',
      };
    },
  });

  const task = createTask();
  await collectEvents(
    new TaskRunOrchestrator(
      {
        suite: createSuite(),
        task,
        run: task.runs[0]!,
        execution: resolveExecutionPolicy(task, runtimeDefaults),
      },
      deps,
    ).run(),
  );

  assert.equal(seenTopFrozen, true);
  assert.equal(seenNestedFrozen, true);
});
