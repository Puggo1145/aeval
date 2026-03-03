import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';

interface CliProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCliProcess(args: string[]): Promise<CliProcessResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.YOUEVAL_DATASETS_ROOT;

    const appRoot = join(import.meta.dirname, '..');
    const cliEntry = join(appRoot, 'src', 'interfaces', 'cli', 'entry.ts');
    const child = spawn(process.execPath, ['--import', 'tsx', cliEntry, ...args], {
      cwd: appRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

test('cli entry prints help when --help is provided', async () => {
  const result = await runCliProcess(['--help']);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /YouEval CLI/);
  assert.equal(result.stderr, '');
});

test('cli entry exits with error for unknown command', async () => {
  const result = await runCliProcess(['unknown-cmd']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /unknown-cmd/);
});
