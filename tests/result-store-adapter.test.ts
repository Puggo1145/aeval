import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLocalResultStoreAdapter } from '../src/adapters/result-store/local-result-store-adapter.js';
import type { TaskSourceAdapter } from '../src/core/adapters/task-source-adapter.js';
import { createCore } from '../src/core/api/index.js';
import { SCHEMA_VERSIONS } from '../src/core/contracts/index.js';
import type { RunManifest } from '../src/core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../src/core/contracts/run-summary.js';
import type { TrialResultRecord } from '../src/core/contracts/trial.js';
import { StoreError, ValidationError } from '../src/core/errors/index.js';
import { InMemoryGraderRegistry, InMemoryProviderRegistry } from '../src/core/runtime/index.js';
import { validateExperimentDefinition } from '../src/core/validation/index.js';

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'youeval-result-store-test-'));
}

function makeManifest(runId: string): RunManifest {
  return {
    schemaVersion: 'run-manifest.v1',
    runId,
    experimentName: 'test-experiment',
    taskSource: {
      adapter: 'local',
      ref: 'dataset://test',
      revision: 'rev-001',
    },
    datasetHash: 'abc123',
    configHash: 'def456',
    startedAt: '2026-03-01T00:00:00.000Z',
  };
}

function makeSummaryRecord(runId: string): RunSummaryRecord {
  return {
    runId,
    summary: {
      schemaVersion: 'run-summary.v1',
      runId,
      runName: 'model-a',
      totalTasks: 2,
      totalTrials: 4,
      passRate: 0.75,
      avgLatencyMs: 150,
    },
  };
}

function makeTrialRecord(
  runId: string,
  taskId: string,
  trialIndex: number,
  pass: boolean,
): TrialResultRecord {
  return {
    runId,
    trial: {
      schemaVersion: 'trial-result.v1',
      taskId,
      runId,
      runName: 'model-a',
      trialIndex,
      execution: {
        schemaVersion: 'execution-result.v1',
        output: pass ? 'correct answer' : 'wrong answer',
      },
      graderResults: [
        {
          name: 'check',
          type: 'contains',
          result: { pass, reason: pass ? 'matched' : 'not matched' },
          weight: 1.0,
        },
      ],
      aggregate: { pass },
      timings: {
        startedAt: '2026-03-01T00:00:00.000Z',
        endedAt: '2026-03-01T00:00:01.000Z',
        durationMs: 1000,
      },
    },
  };
}

// --- saveRunManifest / getRunManifest ---

test('saveRunManifest and getRunManifest round-trip', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const manifest = makeManifest('run-001');

    await store.saveRunManifest(manifest);
    const loaded = await store.getRunManifest('run-001');

    assert.deepStrictEqual(loaded, manifest);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('getRunManifest returns null for non-existent run', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const result = await store.getRunManifest('non-existent');
    assert.strictEqual(result, null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('saveRunManifest overwrites existing manifest (for completedAt update)', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const manifest = makeManifest('run-002');

    await store.saveRunManifest(manifest);

    const updated = { ...manifest, completedAt: '2026-03-01T01:00:00.000Z' };
    await store.saveRunManifest(updated);

    const loaded = await store.getRunManifest('run-002');
    assert.deepStrictEqual(loaded, updated);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// --- saveRunSummary / getRunSummary ---

test('saveRunSummary and getRunSummary round-trip', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const record = makeSummaryRecord('run-003');

    await store.saveRunSummary(record);
    const loaded = await store.getRunSummary('run-003');

    assert.deepStrictEqual(loaded, record);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('getRunSummary returns null for non-existent run', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const result = await store.getRunSummary('non-existent');
    assert.strictEqual(result, null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// --- saveTrial / listTrials ---

test('saveTrial and listTrials round-trip', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const runId = 'run-004';
    const trial0 = makeTrialRecord(runId, 'task/basic-001', 0, true);
    const trial1 = makeTrialRecord(runId, 'task/basic-001', 1, false);
    const trial2 = makeTrialRecord(runId, 'task/basic-002', 0, true);

    await store.saveTrial(trial0);
    await store.saveTrial(trial1);
    await store.saveTrial(trial2);

    const trials = await store.listTrials(runId);
    assert.strictEqual(trials.length, 3);

    // Verify sorted by taskId then trialIndex.
    assert.strictEqual(trials[0]?.trial.taskId, 'task/basic-001');
    assert.strictEqual(trials[0]?.trial.trialIndex, 0);
    assert.strictEqual(trials[1]?.trial.taskId, 'task/basic-001');
    assert.strictEqual(trials[1]?.trial.trialIndex, 1);
    assert.strictEqual(trials[2]?.trial.taskId, 'task/basic-002');
    assert.strictEqual(trials[2]?.trial.trialIndex, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('listTrials returns empty array for non-existent run', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const result = await store.listTrials('non-existent');
    assert.deepStrictEqual(result, []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('listTrials returns empty array when trials dir exists but is empty', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const runId = 'run-empty-trials';
    // Create the trials dir but don't write any files
    await mkdir(join(rootDir, runId, 'trials'), { recursive: true });

    const result = await store.listTrials(runId);
    assert.deepStrictEqual(result, []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// --- listRunIds ---

test('listRunIds returns sorted runIds for runs with summary records', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });

    await store.saveRunSummary(makeSummaryRecord('run-b'));
    await store.saveRunSummary(makeSummaryRecord('run-a'));
    await store.saveRunManifest(makeManifest('run-manifest-only'));

    const runIds = await store.listRunIds();
    assert.deepStrictEqual(runIds, ['run-a', 'run-b']);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('listRunIds returns empty array when root directory does not exist', async () => {
  const rootDir = join(tmpdir(), `youeval-result-store-missing-${Date.now()}`);
  const store = createLocalResultStoreAdapter({ rootDir });

  const runIds = await store.listRunIds();
  assert.deepStrictEqual(runIds, []);
});

// --- saveBaseline / getBaselineRunId ---

test('saveBaseline and getBaselineRunId round-trip', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });

    await store.saveBaseline({ runId: 'run-005', updatedAt: '2026-03-01T00:00:00.000Z' });
    const baselineRunId = await store.getBaselineRunId();

    assert.strictEqual(baselineRunId, 'run-005');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('getBaselineRunId returns null when no baseline is set', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const result = await store.getBaselineRunId();
    assert.strictEqual(result, null);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('saveBaseline overwrites existing baseline', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });

    await store.saveBaseline({ runId: 'run-old', updatedAt: '2026-03-01T00:00:00.000Z' });
    await store.saveBaseline({ runId: 'run-new', updatedAt: '2026-03-01T01:00:00.000Z' });

    const result = await store.getBaselineRunId();
    assert.strictEqual(result, 'run-new');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('baseline path remains stable when cwd changes after adapter creation', async () => {
  const sandboxRoot = await createTempDir();
  const originalCwd = process.cwd();
  const cwdA = join(sandboxRoot, 'cwd-a');
  const cwdB = join(sandboxRoot, 'cwd-b');
  try {
    await mkdir(cwdA, { recursive: true });
    await mkdir(cwdB, { recursive: true });

    process.chdir(cwdA);
    const store = createLocalResultStoreAdapter({ rootDir: './relative-runs-root' });
    await store.saveBaseline({ runId: 'run-cwd-stable', updatedAt: '2026-03-01T00:00:00.000Z' });

    process.chdir(cwdB);
    const baselineRunId = await store.getBaselineRunId();
    assert.strictEqual(baselineRunId, 'run-cwd-stable');
  } finally {
    process.chdir(originalCwd);
    await rm(sandboxRoot, { recursive: true, force: true });
  }
});

// --- Write failure policy ---

test('write failures throw StoreError in strict-only mode', async () => {
  // Use a path that cannot be written to (file instead of directory)
  const rootDir = await createTempDir();
  const blockerPath = join(rootDir, 'blocker-run');
  // Create a file where a directory is expected
  await writeFile(blockerPath, 'not-a-directory', 'utf-8');

  try {
    const store = createLocalResultStoreAdapter({ rootDir: blockerPath });

    await assert.rejects(
      () => store.saveRunManifest(makeManifest('blocker-run')),
      (err: unknown) => {
        assert.ok(err instanceof StoreError);
        return true;
      },
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('write errors do not swallow ValidationError', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });

    await assert.rejects(
      () => store.saveRunManifest(makeManifest('../invalid-run-id')),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        return true;
      },
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('saveTrial rejects mismatched runId and trial.runId', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const record = makeTrialRecord('run-outer', 'task-1', 0, true);
    const mismatchedRecord: TrialResultRecord = {
      ...record,
      trial: {
        ...record.trial,
        runId: 'run-inner',
      },
    };

    await assert.rejects(
      () => store.saveTrial(mismatchedRecord),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.details?.field, 'trial.runId');
        return true;
      },
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('saveRunManifest rejects symlinked run directory escaping root', async () => {
  const rootDir = await createTempDir();
  const outsideDir = await createTempDir();
  const symlinkRunId = 'run-symlink';
  const runLinkPath = join(rootDir, symlinkRunId);
  try {
    await symlink(outsideDir, runLinkPath);
    const store = createLocalResultStoreAdapter({ rootDir });

    await assert.rejects(
      () => store.saveRunManifest(makeManifest(symlinkRunId)),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.details?.field, 'runId');
        return true;
      },
    );

    await assert.rejects(() => access(join(outsideDir, 'manifest.json')));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('empty rootDir is rejected', () => {
  assert.throws(
    () => createLocalResultStoreAdapter({ rootDir: '   ' }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      assert.equal(err.details?.field, 'rootDir');
      return true;
    },
  );
});

// --- Data integrity ---

test('manifest file is valid JSON on disk', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const manifest = makeManifest('run-json-check');
    await store.saveRunManifest(manifest);

    const raw = await readFile(join(rootDir, 'run-json-check', 'manifest.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    assert.deepStrictEqual(parsed, manifest);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('RunManifest.taskSource contains adapter/ref/revision/datasetHash fields', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const manifest = makeManifest('run-verify-fields');
    await store.saveRunManifest(manifest);

    const loaded = await store.getRunManifest('run-verify-fields');
    assert.ok(loaded);
    assert.strictEqual(loaded.taskSource.adapter, 'local');
    assert.strictEqual(loaded.taskSource.ref, 'dataset://test');
    assert.strictEqual(loaded.taskSource.revision, 'rev-001');
    assert.strictEqual(loaded.datasetHash, 'abc123');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// --- Multiple runs in same store ---

test('multiple runs are isolated in separate directories', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });

    await store.saveRunManifest(makeManifest('run-a'));
    await store.saveRunManifest(makeManifest('run-b'));
    await store.saveRunSummary(makeSummaryRecord('run-a'));
    await store.saveRunSummary(makeSummaryRecord('run-b'));

    const manifestA = await store.getRunManifest('run-a');
    const manifestB = await store.getRunManifest('run-b');
    assert.ok(manifestA);
    assert.ok(manifestB);
    assert.strictEqual(manifestA.runId, 'run-a');
    assert.strictEqual(manifestB.runId, 'run-b');

    const summaryA = await store.getRunSummary('run-a');
    const summaryB = await store.getRunSummary('run-b');
    assert.ok(summaryA);
    assert.ok(summaryB);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// --- taskId with path separators ---

test('trial files handle taskIds with slashes correctly', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const runId = 'run-slash-task';
    const trial = makeTrialRecord(runId, 'chat-agent/board-qa/basic-001', 0, true);

    await store.saveTrial(trial);
    const trials = await store.listTrials(runId);

    assert.strictEqual(trials.length, 1);
    assert.strictEqual(trials[0]?.trial.taskId, 'chat-agent/board-qa/basic-001');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('taskId filename encoding avoids collisions between slash and double-dash forms', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });
    const runId = 'run-collision-check';

    await store.saveTrial(makeTrialRecord(runId, 'a/b', 0, true));
    await store.saveTrial(makeTrialRecord(runId, 'a--b', 0, false));

    const trials = await store.listTrials(runId);
    assert.strictEqual(trials.length, 2);
    const taskIds = new Set(trials.map((record) => record.trial.taskId));
    assert.deepStrictEqual(taskIds, new Set(['a/b', 'a--b']));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('runId with path separators is rejected to prevent path traversal', async () => {
  const rootDir = await createTempDir();
  try {
    const store = createLocalResultStoreAdapter({ rootDir });

    await assert.rejects(
      () => store.getRunSummary('../outside-run'),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        return true;
      },
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('local ResultStoreAdapter supports full core run persistence and query readback', async () => {
  const rootDir = await createTempDir();
  try {
    const resultStore = createLocalResultStoreAdapter({ rootDir });
    const taskSourceAdapter: TaskSourceAdapter = {
      async resolveDataset() {
        return {
          source: {
            adapter: 'local',
            ref: 'dataset://smoke',
            revision: 'rev-smoke-001',
            fetchedAt: '2026-03-01T00:00:00.000Z',
          },
          tasks: [
            {
              schemaVersion: SCHEMA_VERSIONS.TASK,
              id: 'task-smoke-001',
              provider: { id: 'mock-provider' },
              graders: {
                strategy: 'ALL',
                layers: [{ name: 'always-pass', type: 'always-pass' }],
              },
              execution: { timeoutMs: 1000 },
            },
          ],
          datasetHash: 'hash-smoke-001',
        };
      },
    };

    const providerRegistry = new InMemoryProviderRegistry();
    providerRegistry.register('mock-provider', async () => ({
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: 'ok',
    }));

    const graderRegistry = new InMemoryGraderRegistry();
    graderRegistry.register('always-pass', async () => ({ pass: true, reason: 'ok' }));

    const core = createCore({
      taskSourceAdapters: {
        local: taskSourceAdapter,
      },
      resultStoreAdapters: {
        local: resultStore,
      },
      providerRegistry,
      graderRegistry,
    });

    const experiment = validateExperimentDefinition({
      schemaVersion: SCHEMA_VERSIONS.EXPERIMENT,
      name: 'result-store-smoke',
      taskSource: {
        adapter: 'local',
      },
      runs: [{ name: 'default' }],
      maxConcurrency: 1,
      resultStore: {
        adapter: 'local',
      },
    });

    const summary = await core.runExperiment({ experiment, runName: 'default' });
    const manifest = await resultStore.getRunManifest(summary.runId);
    const loadedSummary = await core.getRunSummary(summary.runId);
    const loadedTrials = await core.listTrials(summary.runId);

    assert.ok(manifest);
    assert.strictEqual(manifest.taskSource.adapter, 'local');
    assert.strictEqual(manifest.taskSource.ref, 'dataset://smoke');
    assert.strictEqual(manifest.taskSource.revision, 'rev-smoke-001');
    assert.strictEqual(manifest.datasetHash, 'hash-smoke-001');

    assert.ok(loadedSummary);
    assert.strictEqual(loadedSummary.runId, summary.runId);
    assert.strictEqual(loadedTrials.length, 1);
    assert.strictEqual(loadedTrials[0]?.trial.taskId, 'task-smoke-001');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
