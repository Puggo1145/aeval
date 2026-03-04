import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createConsoleObserverAdapter } from '../src/adapters/observer/index.js';
import { createLocalResultStoreAdapter } from '../src/adapters/result-store/index.js';
import { createLocalTaskSourceAdapter } from '../src/adapters/task-source/index.js';
import { createCore } from '../src/core/api/index.js';
import type { ExperimentDefinition, RunEvent } from '../src/core/contracts/index.js';
import { SCHEMA_VERSIONS } from '../src/core/contracts/schema-versions.js';
import { InMemoryGraderRegistry } from '../src/core/runtime/grader-registry.js';
import { InMemoryProviderRegistry } from '../src/core/runtime/provider-registry.js';
import type { JudgeProvider, JudgeProviderInput } from '../src/graders/llm/judge-provider.js';
import { registerBuiltinGraders } from '../src/graders/register-builtins.js';
import { registerReferenceProvider } from '../src/providers/index.js';

function buildSmokeExperiment(): ExperimentDefinition {
  return {
    name: 'chat-agent-smoke',
    runs: [{ name: 'smoke' }],
    maxConcurrency: 2,
  };
}

test('E2E smoke: full chain from taskSource.resolve to resultStore.read', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'youeval-e2e-'));
  try {
    const datasetsRoot = join(tmpDir, 'datasets');
    const datasetDir = join(datasetsRoot, 'chat-agent', 'smoke');
    await mkdir(datasetDir, { recursive: true });

    await writeFile(
      join(datasetDir, 'task-001.yaml'),
      `task:
  schemaVersion: "task.v1"
  id: "chat-agent/smoke/task-001"
  provider:
    id: "reference"
    params:
      output: "Paris"
  graders:
    strategy: "ALL"
    layers:
      - name: "contains-paris"
        type: "contains"
        config:
          mustInclude:
            - pattern: "Paris"
  execution:
    timeoutMs: 10000
    retryOnError: 0
    trialsPerTask: null
`,
    );
    await writeFile(
      join(datasetDir, 'task-002.yaml'),
      `task:
  schemaVersion: "task.v1"
  id: "chat-agent/smoke/task-002"
  provider:
    id: "reference"
    params:
      output: "Berlin"
  graders:
    strategy: "ALL"
    layers:
      - name: "contains-berlin"
        type: "contains"
        config:
          mustInclude:
            - pattern: "Berlin"
  execution:
    timeoutMs: 10000
    retryOnError: 0
    trialsPerTask: null
`,
    );

    const graderRegistry = new InMemoryGraderRegistry();
    registerBuiltinGraders(graderRegistry);

    const providerRegistry = new InMemoryProviderRegistry();
    registerReferenceProvider(providerRegistry);

    const core = createCore({
      taskSourceAdapter: createLocalTaskSourceAdapter({
        datasetsRoot,
        dataset: 'chat-agent/smoke',
      }),
      resultStoreAdapter: createLocalResultStoreAdapter({ rootDir: tmpDir }),
      providerRegistry,
      graderRegistry,
      observerAdapters: [createConsoleObserverAdapter()],
    });

    const experiment = buildSmokeExperiment();
    const events: RunEvent[] = [];

    // 1. Stream the run
    for await (const event of (await core.loadExperiment(experiment)).stream('smoke')) {
      events.push(event);
    }

    // 2. Assert run:completed received with passRate === 1
    const completedEvent = events.find((e) => e.type === 'run:completed');
    assert.ok(completedEvent, 'run:completed event should be emitted');
    assert.equal(completedEvent.type, 'run:completed');
    assert.equal(completedEvent.summary.passRate, 1, 'passRate should be 1');

    const runId = completedEvent.summary.runId;

    // 3. getRunSummary — non-null and passRate === 1
    const summary = await core.getRunSummary(runId);
    assert.ok(summary, 'getRunSummary should return non-null');
    assert.equal(summary.passRate, 1);
    assert.equal(summary.totalTasks, 2);
    assert.equal(summary.totalTrials, 2);

    // 4. listTrials — 2 trials, both passing
    const trials = await core.listTrials(runId);
    assert.equal(trials.length, 2, 'should have 2 trials');
    for (const record of trials) {
      assert.ok(record.trial.aggregate.pass, `trial ${record.trial.taskId} should pass`);
    }

    // 5. listRuns — the run is listed
    const runs = await core.listRuns();
    assert.ok(runs.length >= 1, 'listRuns should return at least 1 run');
    const found = runs.find((r) => r.runId === runId);
    assert.ok(found, 'the run should be listed');

    // 6. setBaseline then compareBaseline — verdict "pass"
    await core.setBaseline(runId);
    const comparison = await core.compareBaseline(runId);
    assert.equal(comparison.verdict, 'pass');

    // 7. Verify RunManifest via result store
    const startedEvent = events.find((e) => e.type === 'run:started');
    assert.ok(startedEvent, 'run:started event should be emitted');
    assert.equal(startedEvent.type, 'run:started');
    assert.equal(startedEvent.runId, runId);
    assert.equal(startedEvent.totalTasks, 2);

    // Verify RunManifest by reading it directly from the result store adapter
    const verifyStore = createLocalResultStoreAdapter({ rootDir: tmpDir });
    const manifest = await verifyStore.getRunManifest(runId);
    assert.ok(manifest, 'RunManifest should be persisted');
    assert.equal(manifest.schemaVersion, SCHEMA_VERSIONS.RUN_MANIFEST);
    assert.equal(manifest.runId, runId);
    assert.equal(manifest.experimentName, 'chat-agent-smoke');
    assert.equal(manifest.taskSource.adapter, 'local');
    assert.equal(manifest.taskSource.ref, 'chat-agent/smoke');
    assert.ok(manifest.taskSource.revision, 'revision should be set');
    assert.ok(manifest.datasetHash, 'datasetHash should be set');
    assert.ok(manifest.configHash, 'configHash should be set');
    assert.ok(manifest.startedAt, 'startedAt should be set');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('E2E smoke: llm-judge protocol chain with mock JudgeProvider', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'youeval-e2e-judge-'));
  try {
    // Create a temporary dataset directory with an llm-judge task
    const datasetDir = join(tmpDir, 'datasets', 'judge-test');
    await mkdir(datasetDir, { recursive: true });

    // Write a task YAML that uses llm-judge grader
    await writeFile(
      join(datasetDir, 'task-003.yaml'),
      `task:
  schemaVersion: "task.v1"
  id: "judge-test/task-003"
  desc: "Test llm-judge protocol chain"
  category: "judge-test"
  capability: "judge"
  tier: "L0"
  difficulty: "easy"
  tags: ["smoke", "llm-judge"]

  provider:
    id: "reference"
    params:
      output: "The capital of France is Paris."

  graders:
    strategy: "ALL"
    layers:
      - name: "judge accuracy"
        type: "llm-judge"
        config:
          dimension: "accuracy"
          rubric: "The output should correctly state that Paris is the capital of France."

  execution:
    timeoutMs: 10000
    retryOnError: 0
    trialsPerTask: null
`,
    );

    const runsDir = join(tmpDir, 'runs');

    // Track mock judge calls
    const judgeCalls: JudgeProviderInput[] = [];
    const mockJudgeProvider: JudgeProvider = {
      async evaluate(input: JudgeProviderInput) {
        judgeCalls.push(input);
        return {
          pass: true,
          score: 1.0,
          reason: 'Mock judge: output is correct.',
          label: 'PASS' as const,
        };
      },
    };

    const datasetsRoot = join(tmpDir, 'datasets');

    const graderRegistry = new InMemoryGraderRegistry();
    registerBuiltinGraders(graderRegistry, { judgeProvider: mockJudgeProvider });

    const providerRegistry = new InMemoryProviderRegistry();
    registerReferenceProvider(providerRegistry);

    const core = createCore({
      taskSourceAdapter: createLocalTaskSourceAdapter({
        datasetsRoot,
        dataset: 'judge-test',
      }),
      resultStoreAdapter: createLocalResultStoreAdapter({ rootDir: runsDir }),
      providerRegistry,
      graderRegistry,
      observerAdapters: [createConsoleObserverAdapter()],
    });

    const experiment: ExperimentDefinition = {
      name: 'judge-protocol-test',
      runs: [{ name: 'judge-run' }],
      maxConcurrency: 1,
    };

    const events: RunEvent[] = [];
    for await (const event of (await core.loadExperiment(experiment)).stream('judge-run')) {
      events.push(event);
    }

    // Verify the run completed without errors
    const completedEvent = events.find((e) => e.type === 'run:completed');
    assert.ok(completedEvent, 'run:completed event should be emitted');
    assert.equal(completedEvent.type, 'run:completed');

    // Verify mock judge was called with correct protocol
    assert.equal(judgeCalls.length, 1, 'mock judge should be called exactly once');
    assert.equal(judgeCalls[0]!.output, 'The capital of France is Paris.');
    assert.equal(judgeCalls[0]!.dimension, 'accuracy');
    assert.ok(
      judgeCalls[0]!.rubric.includes('Paris is the capital of France'),
      'rubric should be passed through',
    );

    // Verify no trial errors
    const errorEvents = events.filter((e) => e.type === 'trial:error');
    assert.equal(errorEvents.length, 0, 'no trial errors expected');
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
