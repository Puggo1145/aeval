import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConsoleObserverAdapter } from '../src/adapters/observer/index.js';
import { createLocalResultStoreAdapter } from '../src/adapters/result-store/index.js';
import { createLocalTaskSourceAdapter } from '../src/adapters/task-source/index.js';
import { type CoreApi, createCore } from '../src/core/api/index.js';
import { ERROR_CODES, ValidationError } from '../src/core/errors/index.js';
import { InMemoryGraderRegistry } from '../src/core/runtime/grader-registry.js';
import { InMemoryProviderRegistry } from '../src/core/runtime/provider-registry.js';
import { registerBuiltinGraders } from '../src/graders/register-builtins.js';
import { runCli } from '../src/interfaces/cli/index.js';
import { registerReferenceProvider } from '../src/providers/index.js';

function createCliCore(options: { runsRoot?: string } = {}): CoreApi {
  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  const providerRegistry = new InMemoryProviderRegistry();
  registerReferenceProvider(providerRegistry);

  return createCore({
    taskSourceAdapter: createLocalTaskSourceAdapter({
      datasetsRoot: '.datasets',
      dataset: 'chat-agent-smoke',
    }),
    resultStoreAdapter: createLocalResultStoreAdapter({ rootDir: options.runsRoot ?? '.youeval/runs' }),
    providerRegistry,
    graderRegistry,
    observerAdapters: [createConsoleObserverAdapter()],
  });
}

function createCompareOnlyCore(
  onCompare: (
    currentRunId: string,
    options?: Parameters<CoreApi['compareBaseline']>[1],
  ) => Promise<void> | void,
): CoreApi {
  return {
    async loadExperiment() {
      throw new Error('not used');
    },
    async getRunSummary() {
      throw new Error('not used');
    },
    async listTrials() {
      throw new Error('not used');
    },
    async setBaseline() {
      throw new Error('not used');
    },
    async compareBaseline(currentRunId, options) {
      await onCompare(currentRunId, options);
      return {
        baselineRunId: options?.baselineRunId ?? 'baseline-default',
        currentRunId,
        passRateDelta: 0,
        regressions: [],
        improvements: [],
        verdict: 'pass',
      };
    },
    async listRuns() {
      throw new Error('not used');
    },
  };
}

test('runCli returns 0 when no args are provided', async (t) => {
  t.mock.method(console, 'log', () => {});

  const exitCode = await runCli([], createCliCore());

  assert.equal(exitCode, 0);
});

test('runCli returns 0 when --help is the first arg', async (t) => {
  t.mock.method(console, 'log', () => {});

  const exitCode = await runCli(['--help'], createCliCore());

  assert.equal(exitCode, 0);
});

test('runCli throws validation unknown command error for unknown command', async () => {
  await assert.rejects(
    () => runCli(['unknown'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, ERROR_CODES.VALIDATION_UNKNOWN_COMMAND);
      return true;
    },
  );
});

test('runCli does not treat trailing --help as global success', async () => {
  await assert.rejects(
    () => runCli(['unknown', '--help'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.code, ERROR_CODES.VALIDATION_UNKNOWN_COMMAND);
      return true;
    },
  );
});

test('run command throws when --experiment flag is missing', async () => {
  await assert.rejects(
    () => runCli(['run', '--run', 'test'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('--experiment'));
      return true;
    },
  );
});

test('run command throws when --run flag is missing', async () => {
  await assert.rejects(
    () => runCli(['run', '--experiment', 'test.yaml'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('--run'));
      return true;
    },
  );
});

test('run command fails fast when experiment yaml includes unknown fields', async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'youeval-test-'));
  const experimentPath = join(tmpDir, 'invalid-experiment.yaml');
  await writeFile(
    experimentPath,
    `name: "invalid"
runs:
  - name: "smoke"
maxConcurrency: 1
schemaVersion: "experiment.v2"
`,
  );

  try {
    await assert.rejects(
      () => runCli(['run', '--experiment', experimentPath, '--run', 'smoke'], createCliCore()),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        return true;
      },
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('report command throws when runId is missing', async () => {
  await assert.rejects(
    () => runCli(['report'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('runId'));
      return true;
    },
  );
});

test('report command returns 1 for non-existent run', async (t) => {
  t.mock.method(console, 'error', () => {});

  const tmpDir = await mkdtemp(join(tmpdir(), 'youeval-test-'));
  try {
    const core = createCliCore({ runsRoot: tmpDir });
    const exitCode = await runCli(['report', 'nonexistent-run'], core);
    assert.equal(exitCode, 1);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('runs command returns 0 with no runs', async (t) => {
  t.mock.method(console, 'log', () => {});

  const tmpDir = await mkdtemp(join(tmpdir(), 'youeval-test-'));
  try {
    const core = createCliCore({ runsRoot: tmpDir });
    const exitCode = await runCli(['runs'], core);
    assert.equal(exitCode, 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('trials command throws when runId is missing', async () => {
  await assert.rejects(
    () => runCli(['trials'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('runId'));
      return true;
    },
  );
});

test('trials command returns 0 for non-existent run', async (t) => {
  t.mock.method(console, 'log', () => {});

  const tmpDir = await mkdtemp(join(tmpdir(), 'youeval-test-'));
  try {
    const core = createCliCore({ runsRoot: tmpDir });
    const exitCode = await runCli(['trials', 'nonexistent-run'], core);
    assert.equal(exitCode, 0);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('baseline command throws for unknown subcommand', async () => {
  await assert.rejects(
    () => runCli(['baseline', 'unknown'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('unknown'));
      return true;
    },
  );
});

test('baseline set command throws when runId is missing', async () => {
  await assert.rejects(
    () => runCli(['baseline', 'set'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('runId'));
      return true;
    },
  );
});

test('baseline command throws when no subcommand is given', async () => {
  await assert.rejects(
    () => runCli(['baseline'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      return true;
    },
  );
});

test('baseline compare parses thresholds and token budget flags', async (t) => {
  t.mock.method(console, 'log', () => {});

  let capturedRunId = '';
  let capturedOptions: Parameters<CoreApi['compareBaseline']>[1] | undefined;
  const core = createCompareOnlyCore((currentRunId, options) => {
    capturedRunId = currentRunId;
    capturedOptions = options;
  });

  const exitCode = await runCli(
    [
      'baseline',
      'compare',
      'current-run',
      '--baseline',
      'baseline-run',
      '--pass-rate-drop',
      '0.1',
      '--pass-hat-k-drop',
      '0.2',
      '--avg-latency-increase',
      '50',
      '--token-budget-breached',
      'true',
    ],
    core,
  );

  assert.equal(exitCode, 0);
  assert.equal(capturedRunId, 'current-run');
  assert.deepEqual(capturedOptions, {
    baselineRunId: 'baseline-run',
    thresholds: {
      passRateDrop: 0.1,
      passHatKDrop: 0.2,
      avgLatencyIncrease: 50,
    },
    tokenBudgetBreached: true,
  });
});

test('baseline compare rejects invalid numeric threshold flag', async () => {
  const core = createCompareOnlyCore(() => {});

  await assert.rejects(
    () => runCli(['baseline', 'compare', 'current-run', '--pass-rate-drop', '-1'], core),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('--pass-rate-drop'));
      return true;
    },
  );
});

test('baseline compare rejects missing value for --baseline flag', async () => {
  const core = createCompareOnlyCore(() => {});

  await assert.rejects(
    () => runCli(['baseline', 'compare', 'current-run', '--baseline'], core),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('--baseline'));
      return true;
    },
  );
});

test('baseline compare rejects missing value for --token-budget-breached flag', async () => {
  const core = createCompareOnlyCore(() => {});

  await assert.rejects(
    () => runCli(['baseline', 'compare', 'current-run', '--token-budget-breached'], core),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('--token-budget-breached'));
      return true;
    },
  );
});
