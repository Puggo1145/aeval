import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppCore } from '../src/bootstrap/create-app-core.js';
import { ERROR_CODES, RuntimeError, ValidationError } from '../src/core/errors/index.js';
import { runCli } from '../src/interfaces/cli/index.js';

function createCliCore() {
  return createAppCore({
    datasetsRoot: '/tmp',
  });
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

test('runCli throws runtime not implemented error for known command', async () => {
  await assert.rejects(
    () => runCli(['run'], createCliCore()),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, ERROR_CODES.RUNTIME_NOT_IMPLEMENTED);
      return true;
    },
  );
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
