import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { LocalTask } from '../src/adapters/task-source/local-task-source-adapter.js';
import { Suite } from '../src/core/domain/suite.js';
import { Task } from '../src/core/domain/task.js';

async function createTempRootDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'youeval-task-source-'));
}

async function writeYaml(rootDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = join(rootDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

const SUITE_YAML = `schemaVersion: "suite.v1"
id: "basic-llm"
name: "Basic LLM"
discover:
  - "datasets/**/*.yaml"
`;

const TASK_ONE_YAML = `schemaVersion: "task.v1"
id: "basic-llm/task-001"
desc: "first task"
capability: "qa"
provider:
  id: "reference"
  runs:
    - name: "mini"
      params:
        prompt: "hello"
    - name: "nano"
      params:
        prompt: "hello"
graders:
  strategy: "ALL"
  layers:
    - name: "contains hello"
      type: "contains"
      config:
        mustInclude:
          - pattern: "hello"
            caseSensitive: false
execution:
  timeoutMs: 1000
`;

const TASK_TWO_YAML = `schemaVersion: "task.v1"
id: "basic-llm/task-002"
category: "chat"
provider:
  id: "reference"
  runs:
    - name: "mini"
      params:
        prompt: "world"
graders:
  strategy: "ALL"
  layers:
    - name: "contains world"
      type: "contains"
      config:
        mustInclude:
          - pattern: "world"
            caseSensitive: false
execution:
  timeoutMs: 1000
`;

const TASK_ONE_REFORMATTED_YAML = `execution:
  timeoutMs: 1000
provider:
  runs:
    - params:
        prompt: "hello"
      name: "mini"
    - params:
        prompt: "hello"
      name: "nano"
  id: "reference"
graders:
  layers:
    - config:
        mustInclude:
          - caseSensitive: false
            pattern: "hello"
      name: "contains hello"
      type: "contains"
  strategy: "ALL"
capability: "qa"
desc: "first task"
id: "basic-llm/task-001"
schemaVersion: "task.v1"
`;

test('listSuites returns suite descriptors discovered under rootDir', async () => {
  const rootDir = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'suites/basic.yaml', SUITE_YAML);
    await writeYaml(rootDir, 'datasets/a-task.yaml', TASK_ONE_YAML);

    const adapter = new LocalTask({ rootDir });
    const suites = await adapter.listSuites();

    assert.deepEqual(suites, [
      {
        id: 'basic-llm',
        name: 'Basic LLM',
        ref: 'suites/basic.yaml',
      },
    ]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('resolveSuite expands discover globs into task refs', async () => {
  const rootDir = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'suites/basic.yaml', SUITE_YAML);
    await writeYaml(rootDir, 'datasets/z-task.yaml', TASK_TWO_YAML);
    await writeYaml(rootDir, 'datasets/a-task.yaml', TASK_ONE_YAML);

    const adapter = new LocalTask({ rootDir });
    const resolvedSuite = await adapter.resolveSuite('basic-llm');
    const taskRefs = resolvedSuite.taskRefs;
    const suite = Suite.fromDocument(resolvedSuite.document);

    assert.equal(suite.id, 'basic-llm');
    assert.equal(taskRefs.length, 2);
    assert.deepEqual(
      taskRefs.map((taskRef) => taskRef.ref).sort(),
      ['datasets/a-task.yaml', 'datasets/z-task.yaml'],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('resolveSuite ignores colocated suite documents matched by discover globs', async () => {
  const rootDir = await createTempRootDir();
  try {
    await writeYaml(
      rootDir,
      'datasets/group-a/suite.yaml',
      `schemaVersion: "suite.v1"
id: "basic-llm"
name: "Basic LLM"
discover:
  - "datasets/group-a/**/*.yaml"
`,
    );
    await writeYaml(rootDir, 'datasets/group-a/task-a.yaml', TASK_ONE_YAML);
    await writeYaml(rootDir, 'datasets/group-a/task-b.yaml', TASK_TWO_YAML);

    const adapter = new LocalTask({ rootDir });
    const resolvedSuite = await adapter.resolveSuite('basic-llm');
    const taskRefs = resolvedSuite.taskRefs;

    assert.deepEqual(
      taskRefs.map((taskRef) => taskRef.ref).sort(),
      ['datasets/group-a/task-a.yaml', 'datasets/group-a/task-b.yaml'],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('resolveTask returns raw task input and stable source revision', async () => {
  const rootDir = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'task-a.yaml', TASK_ONE_YAML);
    await writeYaml(rootDir, 'task-b.yaml', TASK_ONE_REFORMATTED_YAML);

    const adapter = new LocalTask({ rootDir });
    const taskA = await adapter.resolveTask({ suiteId: 'basic-llm', ref: 'task-a.yaml' });
    const taskB = await adapter.resolveTask({ suiteId: 'basic-llm', ref: 'task-b.yaml' });
    const normalizedTask = Task.fromDocument(taskA.document);

    assert.equal(normalizedTask.id, 'basic-llm/task-001');
    assert.equal(taskA.source.revision, taskB.source.revision);
    assert.ok(taskA.source.revision.startsWith('sha256-'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('resolveTask fails when ref points to a suite document', async () => {
  const rootDir = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'suites/basic.yaml', SUITE_YAML);

    const adapter = new LocalTask({ rootDir });

    await assert.rejects(
      () => adapter.resolveTask({ suiteId: 'basic-llm', ref: 'suites/basic.yaml' }),
      /resolves to a suite document/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('resolveTask fails when YAML document is not task.v1', async () => {
  const rootDir = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'not-a-task.yaml', 'notTask:\n  id: "wrong"\n');

    const adapter = new LocalTask({ rootDir });

    await assert.rejects(
      () => adapter.resolveTask({ suiteId: 'basic-llm', ref: 'not-a-task.yaml' }),
      /must declare schemaVersion 'task.v1'/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('resolveSuite returns task refs without projecting task ids', async () => {
  const rootDir = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'suites/basic.yaml', SUITE_YAML);
    await writeYaml(rootDir, 'datasets/task-a.yaml', TASK_ONE_YAML);
    await writeYaml(rootDir, 'datasets/task-b.yaml', TASK_ONE_REFORMATTED_YAML);

    const adapter = new LocalTask({ rootDir });
    const resolvedSuite = await adapter.resolveSuite('basic-llm');

    assert.deepEqual(
      resolvedSuite.taskRefs.map((taskRef) => taskRef.ref).sort(),
      ['datasets/task-a.yaml', 'datasets/task-b.yaml'],
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('listSuites fails fast when rootDir contains symlinked YAML paths', async () => {
  const rootDir = await createTempRootDir();
  const externalRoot = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'suites/basic.yaml', SUITE_YAML);
    await writeYaml(externalRoot, 'outside.yaml', TASK_ONE_YAML);
    await mkdir(join(rootDir, 'datasets'), { recursive: true });
    await symlink(join(externalRoot, 'outside.yaml'), join(rootDir, 'datasets', 'linked.yaml'));

    const adapter = new LocalTask({ rootDir });

    await assert.rejects(() => adapter.listSuites(), /Symbolic links are not allowed/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('listSuites ignores symlinks under node_modules', async () => {
  const rootDir = await createTempRootDir();
  const externalRoot = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'suites/basic.yaml', SUITE_YAML);
    await writeYaml(rootDir, 'datasets/a-task.yaml', TASK_ONE_YAML);
    await mkdir(join(rootDir, 'node_modules', '@ai-sdk'), { recursive: true });
    await symlink(
      join(externalRoot, 'openai'),
      join(rootDir, 'node_modules', '@ai-sdk', 'openai'),
    );

    const adapter = new LocalTask({ rootDir });
    const suites = await adapter.listSuites();

    assert.deepEqual(suites, [
      {
        id: 'basic-llm',
        name: 'Basic LLM',
        ref: 'suites/basic.yaml',
      },
    ]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('resolveSuite fails when matched files are not task YAML documents', async () => {
  const rootDir = await createTempRootDir();
  try {
    await writeYaml(rootDir, 'suites/basic.yaml', SUITE_YAML);
    await writeYaml(rootDir, 'datasets/not-a-task.yaml', 'notTask:\n  id: "wrong"\n');

    const adapter = new LocalTask({ rootDir });

    await assert.rejects(() => adapter.resolveSuite('basic-llm'), /schemaVersion/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
