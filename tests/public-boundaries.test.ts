import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function collectTsFiles(rootDir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const path = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(path));
      continue;
    }

    if (entry.isFile() && path.endsWith('.ts')) {
      files.push(path);
    }
  }

  return files;
}

test('built-in modules do not import core internals through relative core paths', () => {
  const roots = ['src/adapters', 'src/graders', 'src/interfaces'];
  const offenders: string[] = [];

  for (const root of roots) {
    for (const file of collectTsFiles(root)) {
      const content = readFileSync(file, 'utf8');
      if (/\.\.\/.*core\//.test(content)) {
        offenders.push(file);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test('package exports expose only root and declared public subpaths', async () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    exports: Record<string, unknown>;
  };

  assert.deepEqual(Object.keys(pkg.exports).sort(), [
    '.',
    './adapters',
    './graders',
    './interfaces/tui',
    './tools',
  ]);
});

test('root public surface does not expose parser helpers; tools surface does', async () => {
  const rootExports = await import('../src/index.ts');
  const toolsExports = await import('../src/tools/index.ts');

  assert.equal('parseSuiteDocument' in rootExports, false);
  assert.equal('parseTaskDocument' in rootExports, false);
  assert.equal('parseExecutionResult' in rootExports, false);

  assert.equal(typeof toolsExports.parseSuiteDocument, 'function');
  assert.equal(typeof toolsExports.parseTaskDocument, 'function');
  assert.equal(typeof toolsExports.parseExecutionResult, 'function');
});
