import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

interface PackageManifest {
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readPackageManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

test('built-in modules do not import core internals through relative core paths', () => {
  const roots = [
    'packages/adapter-task-source-local/src',
    'packages/adapter-result-store-local/src',
    'packages/adapter-observer-console/src',
    'packages/graders/src',
    'packages/interface-tui/src',
  ];
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

test('workspace package exports expose only declared public subpaths', () => {
  const coreManifest = readPackageManifest('packages/core/package.json');
  const gradersManifest = readPackageManifest('packages/graders/package.json');
  const taskSourceManifest = readPackageManifest('packages/adapter-task-source-local/package.json');
  const resultStoreManifest = readPackageManifest(
    'packages/adapter-result-store-local/package.json',
  );
  const observerManifest = readPackageManifest('packages/adapter-observer-console/package.json');
  const tuiManifest = readPackageManifest('packages/interface-tui/package.json');

  assert.deepEqual(Object.keys(coreManifest.exports ?? {}).sort(), ['.', './tools']);
  assert.deepEqual(Object.keys(gradersManifest.exports ?? {}).sort(), ['.']);
  assert.deepEqual(Object.keys(taskSourceManifest.exports ?? {}).sort(), ['.']);
  assert.deepEqual(Object.keys(resultStoreManifest.exports ?? {}).sort(), ['.']);
  assert.deepEqual(Object.keys(observerManifest.exports ?? {}).sort(), ['.']);
  assert.deepEqual(Object.keys(tuiManifest.exports ?? {}).sort(), ['.']);
});

test('core root public surface does not expose parser helpers; tools surface does', async () => {
  const coreModuleId = '../packages/core/dist/index.js';
  const toolsModuleId = '../packages/core/dist/tools/index.js';

  const coreExports = await import(coreModuleId);
  const toolsExports = await import(toolsModuleId);

  assert.equal('parseSuiteDocument' in coreExports, false);
  assert.equal('parseTaskDocument' in coreExports, false);
  assert.equal('parseExecutionResult' in coreExports, false);

  assert.equal(typeof toolsExports.parseSuiteDocument, 'function');
  assert.equal(typeof toolsExports.parseTaskDocument, 'function');
  assert.equal(typeof toolsExports.parseExecutionResult, 'function');
});

test('core package dependencies exclude optional adapters/tui/grader runtime deps', () => {
  const coreManifest = readPackageManifest('packages/core/package.json');
  const dependencies = Object.keys(coreManifest.dependencies ?? {});
  const disallowedDependencies = ['@clack/prompts', 'ai', 'ajv', 'yaml'];

  for (const dependency of disallowedDependencies) {
    assert.equal(dependencies.includes(dependency), false);
  }
});

test('plugin packages declare @youeval/core as a peer dependency', () => {
  const pluginPackages = [
    readPackageManifest('packages/graders/package.json'),
    readPackageManifest('packages/adapter-task-source-local/package.json'),
    readPackageManifest('packages/adapter-result-store-local/package.json'),
    readPackageManifest('packages/adapter-observer-console/package.json'),
    readPackageManifest('packages/interface-tui/package.json'),
  ];

  for (const manifest of pluginPackages) {
    assert.equal(Boolean(manifest.peerDependencies?.['@youeval/core']), true);
  }
});
