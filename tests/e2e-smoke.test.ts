import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { createAppCore } from '../src/bootstrap/create-app-core.js';
import type { ExperimentDefinition, RunEvent } from '../src/core/contracts/index.js';
import { SCHEMA_VERSIONS } from '../src/core/contracts/schema-versions.js';
import type { JudgeProvider, JudgeProviderInput } from '../src/graders/llm/judge-provider.js';

const DATASETS_ROOT = resolve('.datasets');

function buildSmokeExperiment(): ExperimentDefinition {
  return {
    schemaVersion: SCHEMA_VERSIONS.EXPERIMENT,
    name: 'chat-agent-smoke',
    taskSource: {
      adapter: 'local',
      ref: 'dataset://chat-agent/smoke',
    },
    runs: [{ name: 'smoke' }],
    maxConcurrency: 2,
    resultStore: {
      adapter: 'local',
    },
  };
}

test('E2E smoke: full chain from taskSource.resolve to resultStore.read', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'youeval-e2e-'));
  try {
    const core = createAppCore({
      runsRoot: tmpDir,
    });

    const experiment = buildSmokeExperiment();
    const events: RunEvent[] = [];

    // 1. Stream the run
    for await (const event of core.streamRun({ experiment, runName: 'smoke', datasetsRoot: DATASETS_ROOT })) {
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
    //    We access it through the local adapter indirectly — getRunSummary already proved
    //    the run exists, but we also check manifest fields by reading it through the adapter.
    //    Since createAppCore builds a local result store, we can construct a second adapter
    //    to read the manifest file. Instead, let's use the core's public API to verify
    //    the summary has the expected shape, and check manifest fields from the completed event.
    const startedEvent = events.find((e) => e.type === 'run:started');
    assert.ok(startedEvent, 'run:started event should be emitted');
    assert.equal(startedEvent.type, 'run:started');
    assert.equal(startedEvent.runId, runId);
    assert.equal(startedEvent.totalTasks, 2);

    // Verify RunManifest by reading it directly from the result store adapter
    const { createLocalResultStoreAdapter } = await import(
      '../src/adapters/result-store/local-result-store-adapter.js'
    );
    const verifyStore = createLocalResultStoreAdapter({ rootDir: tmpDir });
    const manifest = await verifyStore.getRunManifest(runId);
    assert.ok(manifest, 'RunManifest should be persisted');
    assert.equal(manifest.schemaVersion, SCHEMA_VERSIONS.RUN_MANIFEST);
    assert.equal(manifest.runId, runId);
    assert.equal(manifest.experimentName, 'chat-agent-smoke');
    assert.equal(manifest.taskSource.adapter, 'local');
    assert.equal(manifest.taskSource.ref, 'dataset://chat-agent/smoke');
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
    const { mkdir, writeFile } = await import('node:fs/promises');
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
    passThreshold: null
    layers:
      - name: "judge accuracy"
        type: "llm-judge"
        weight: 1.0
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
    const core = createAppCore({
      runsRoot: runsDir,
      judgeProvider: mockJudgeProvider,
    });

    const experiment: ExperimentDefinition = {
      schemaVersion: SCHEMA_VERSIONS.EXPERIMENT,
      name: 'judge-protocol-test',
      taskSource: {
        adapter: 'local',
        ref: 'dataset://judge-test',
      },
      runs: [{ name: 'judge-run' }],
      maxConcurrency: 1,
      resultStore: {
        adapter: 'local',
      },
    };

    const events: RunEvent[] = [];
    for await (const event of core.streamRun({ experiment, runName: 'judge-run', datasetsRoot })) {
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
