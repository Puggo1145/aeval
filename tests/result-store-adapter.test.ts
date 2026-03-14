import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LocalStore } from '../packages/adapter-result-store-local/src/local-result-store-adapter.js';
import { SCHEMA_VERSIONS } from '../packages/core/src/core/contracts/schema-versions.js';

async function createTempResultsDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'youeval-results-'));
}

function createManifest(runId: string) {
  return {
    schemaVersion: SCHEMA_VERSIONS.RUN_MANIFEST,
    runId,
    suiteId: 'basic-llm',
    suiteName: 'Basic LLM',
    taskId: 'basic-llm/task-001',
    runName: 'mini',
    taskSource: {
      adapter: 'local',
      ref: 'datasets/task-001.yaml',
      revision: 'sha256-task-001',
    },
    taskHash: 'task-hash-001',
    configHash: 'config-hash-001',
    startedAt: '2026-03-05T00:00:00.000Z',
  };
}

function createSummary(runId: string) {
  return {
    runId,
    summary: {
      schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
      runId,
      taskId: 'basic-llm/task-001',
      runName: 'mini',
      totalTrials: 2,
      passRate: 1,
      passAtK: 1,
      passHatK: 1,
      avgLatencyMs: 42,
    },
  };
}

function createTrial(runId: string, trialIndex: number, pass = true) {
  return {
    runId,
    trial: {
      schemaVersion: SCHEMA_VERSIONS.TRIAL_RESULT,
      taskId: 'basic-llm/task-001',
      runId,
      runName: 'mini',
      trialIndex,
      execution: {
        schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
        output: pass ? 'ok' : 'fail',
        metrics: {
          latencyMs: 50 + trialIndex,
        },
      },
      graderResults: [],
      aggregate: {
        pass,
      },
      timings: {
        startedAt: '2026-03-05T00:00:00.000Z',
        endedAt: '2026-03-05T00:00:01.000Z',
        durationMs: 1000,
      },
    },
  };
}

test('local result store saves and reads back manifest, summary, and trials', async () => {
  const rootDir = await createTempResultsDir();
  try {
    const adapter = new LocalStore({ rootDir });
    await adapter.saveRunManifest(createManifest('run-1'));
    await adapter.saveRunSummary(createSummary('run-1'));
    await adapter.saveTrial(createTrial('run-1', 0));

    const manifest = await adapter.getRunManifest('run-1');
    const summary = await adapter.getRunSummary('run-1');
    const trials = await adapter.listTrials('run-1');

    assert.equal(manifest?.suiteId, 'basic-llm');
    assert.equal(summary?.summary.taskId, 'basic-llm/task-001');
    assert.equal(trials.length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('local result store returns null when summary file is missing', async () => {
  const rootDir = await createTempResultsDir();
  try {
    const adapter = new LocalStore({ rootDir });
    await adapter.saveRunManifest(createManifest('run-2'));
    await adapter.saveTrial(createTrial('run-2', 0, true));
    await adapter.saveTrial(createTrial('run-2', 1, false));

    const recovered = await adapter.getRunSummary('run-2');

    assert.equal(recovered, null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('local result store does not synthesize manifest-only summaries', async () => {
  const rootDir = await createTempResultsDir();
  try {
    const adapter = new LocalStore({ rootDir });
    await adapter.saveRunManifest(createManifest('run-3'));

    const recovered = await adapter.getRunSummary('run-3');

    assert.equal(recovered, null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('local result store clears selected runs', async () => {
  const rootDir = await createTempResultsDir();
  try {
    const adapter = new LocalStore({ rootDir });
    await adapter.saveRunManifest(createManifest('run-4'));
    await adapter.saveRunSummary(createSummary('run-4'));

    const deletedEntries = await adapter.clearResultsByRunIds(['run-4']);

    assert.ok(deletedEntries.some((entry) => entry.path === 'run-4' && entry.kind === 'dir'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
