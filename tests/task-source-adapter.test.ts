import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLocalTaskSourceAdapter } from '../src/adapters/task-source/local-task-source-adapter.js';
import { RuntimeError, ValidationError } from '../src/core/errors/index.js';

async function createTempDatasetDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'youeval-test-'));
}

async function writeTaskFile(dir: string, name: string, content: string): Promise<void> {
  await writeFile(join(dir, name), content, 'utf-8');
}

const MINIMAL_TASK_YAML = `task:
  schemaVersion: "task.v1"
  id: "test/basic-001"
  provider:
    id: "reference"
    params:
      userMessage: "Hello"
  graders:
    strategy: "ALL"
    layers:
      - name: "check"
        type: "contains"
        weight: 1.0
        config:
          mustInclude:
            - pattern: "Hello"
              caseSensitive: false
  execution:
    timeoutMs: 10000
`;

const SECOND_TASK_YAML = `task:
  schemaVersion: "task.v1"
  id: "test/basic-002"
  provider:
    id: "reference"
  graders:
    strategy: "ALL"
    layers:
      - name: "check"
        type: "contains"
        weight: 1.0
  execution:
    timeoutMs: 5000
`;

const URL_TAG_TASK_YAML = `task:
  schemaVersion: "task.v1"
  id: "test/url-tag-001"
  tags:
    - "http://example.com/resource"
  provider:
    id: "reference"
  graders:
    strategy: "ALL"
    layers:
      - name: "check"
        type: "contains"
        weight: 1.0
  execution:
    timeoutMs: 1000
`;

test('resolveDataset returns tasks from local YAML files', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'chat-agent', 'smoke');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'task-001.yaml', MINIMAL_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result = await adapter.resolveDataset({
      ref: 'dataset://chat-agent/smoke',
    });

    assert.equal(result.source.adapter, 'local');
    assert.equal(result.source.ref, 'dataset://chat-agent/smoke');
    assert.ok(result.source.revision.startsWith('sha256-'));
    assert.ok(result.source.fetchedAt.length > 0);
    assert.equal(result.tasks.length, 1);
    assert.ok(result.datasetHash.length > 0);

    const task = result.tasks[0] as Record<string, unknown>;
    assert.equal(task.id, 'test/basic-001');
    assert.equal(task.schemaVersion, 'task.v1');
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset reads multiple YAML files in deterministic sorted order', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'suite');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'z-task.yaml', SECOND_TASK_YAML);
    await writeTaskFile(suiteDir, 'a-task.yaml', MINIMAL_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result = await adapter.resolveDataset({ ref: 'dataset://suite' });

    assert.equal(result.tasks.length, 2);
    // Files sorted alphabetically: a-task.yaml before z-task.yaml
    const first = result.tasks[0] as Record<string, unknown>;
    const second = result.tasks[1] as Record<string, unknown>;
    assert.equal(first.id, 'test/basic-001');
    assert.equal(second.id, 'test/basic-002');
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset produces deterministic datasetHash for same content', async () => {
  const tempDir1 = await createTempDatasetDir();
  const tempDir2 = await createTempDatasetDir();
  try {
    for (const dir of [tempDir1, tempDir2]) {
      const suiteDir = join(dir, 'suite');
      await mkdir(suiteDir, { recursive: true });
      await writeTaskFile(suiteDir, 'task.yaml', MINIMAL_TASK_YAML);
    }

    const adapter1 = createLocalTaskSourceAdapter({ datasetsRoot: tempDir1 });
    const adapter2 = createLocalTaskSourceAdapter({ datasetsRoot: tempDir2 });

    const result1 = await adapter1.resolveDataset({ ref: 'dataset://suite' });
    const result2 = await adapter2.resolveDataset({ ref: 'dataset://suite' });

    assert.equal(result1.datasetHash, result2.datasetHash);
  } finally {
    await rm(tempDir1, { recursive: true });
    await rm(tempDir2, { recursive: true });
  }
});

test('resolveDataset uses selector.revision when provided', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'suite');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'task.yaml', MINIMAL_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result = await adapter.resolveDataset({
      ref: 'dataset://suite',
      selector: { revision: 'rev-2026-02-28-001' },
    });

    assert.equal(result.source.revision, 'rev-2026-02-28-001');
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset resolves selector.tag to revision via .tags.json', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'suite');
    const revisionDir = join(suiteDir, 'revisions', 'rev-stable-001');
    await mkdir(revisionDir, { recursive: true });
    await writeTaskFile(revisionDir, 'task.yaml', MINIMAL_TASK_YAML);
    await writeTaskFile(
      suiteDir,
      '.tags.json',
      JSON.stringify({
        stable: 'rev-stable-001',
      }),
    );

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result = await adapter.resolveDataset({
      ref: 'dataset://suite',
      selector: { tag: 'stable' },
    });

    assert.equal(result.source.revision, 'rev-stable-001');
    assert.equal(result.tasks.length, 1);
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset fails fast when selector.tag cannot be resolved', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'suite');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'task.yaml', MINIMAL_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });

    await assert.rejects(
      () =>
        adapter.resolveDataset({
          ref: 'dataset://suite',
          selector: { tag: 'release' },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('not found'));
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset fails fast when selector.revision and selector.tag are both provided', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'suite');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'task.yaml', MINIMAL_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });

    await assert.rejects(
      () =>
        adapter.resolveDataset({
          ref: 'dataset://suite',
          selector: {
            revision: 'rev-001',
            tag: 'stable',
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('cannot be used together'));
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset fails fast on invalid ref prefix', async () => {
  const adapter = createLocalTaskSourceAdapter({ datasetsRoot: '/tmp' });

  await assert.rejects(
    () => adapter.resolveDataset({ ref: 'invalid://path' }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('dataset://'));
      return true;
    },
  );
});

test('resolveDataset fails fast on empty ref path', async () => {
  const adapter = createLocalTaskSourceAdapter({ datasetsRoot: '/tmp' });

  await assert.rejects(
    () => adapter.resolveDataset({ ref: 'dataset://' }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      return true;
    },
  );
});

test('resolveDataset fails fast on relative traversal path', async () => {
  const adapter = createLocalTaskSourceAdapter({ datasetsRoot: '/tmp' });

  await assert.rejects(
    () => adapter.resolveDataset({ ref: 'dataset://../secret' }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('traversal'));
      return true;
    },
  );
});

test('resolveDataset fails fast on absolute path', async () => {
  const adapter = createLocalTaskSourceAdapter({ datasetsRoot: '/tmp' });

  await assert.rejects(
    () => adapter.resolveDataset({ ref: 'dataset:///tmp/secret' }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.ok(error.message.includes('Absolute path'));
      return true;
    },
  );
});

test('resolveDataset fails fast when directory does not exist', async () => {
  const adapter = createLocalTaskSourceAdapter({ datasetsRoot: '/tmp/nonexistent-youeval-dir' });

  await assert.rejects(
    () => adapter.resolveDataset({ ref: 'dataset://missing/suite' }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      return true;
    },
  );
});

test('resolveDataset fails fast when directory has no YAML files', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'empty-suite');
    await mkdir(suiteDir, { recursive: true });
    await writeFile(join(suiteDir, 'readme.txt'), 'not a yaml file', 'utf-8');

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });

    await assert.rejects(
      () => adapter.resolveDataset({ ref: 'dataset://empty-suite' }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('no YAML'));
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset fails fast when YAML file is missing task key', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'bad');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'bad.yaml', 'notTask:\n  id: "test"');

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });

    await assert.rejects(
      () => adapter.resolveDataset({ ref: 'dataset://bad' }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes("'task'"));
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset fails fast when task file is a symbolic link', async () => {
  const tempDir = await createTempDatasetDir();
  const externalDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'suite');
    await mkdir(suiteDir, { recursive: true });

    const externalTaskFile = join(externalDir, 'external.yaml');
    await writeTaskFile(externalDir, 'external.yaml', MINIMAL_TASK_YAML);
    await symlink(externalTaskFile, join(suiteDir, 'task.yaml'));

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });

    await assert.rejects(
      () => adapter.resolveDataset({ ref: 'dataset://suite' }),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('symbolic link'));
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await rm(externalDir, { recursive: true, force: true });
  }
});

test('resolveDataset parses nested YAML structures correctly', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'nested');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'task.yaml', MINIMAL_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result = await adapter.resolveDataset({ ref: 'dataset://nested' });

    const task = result.tasks[0] as Record<string, unknown>;
    assert.equal(task.schemaVersion, 'task.v1');
    assert.equal(task.id, 'test/basic-001');

    const provider = task.provider as Record<string, unknown>;
    assert.equal(provider.id, 'reference');

    const params = provider.params as Record<string, unknown>;
    assert.equal(params.userMessage, 'Hello');

    const graders = task.graders as Record<string, unknown>;
    assert.equal(graders.strategy, 'ALL');

    const layers = graders.layers as Record<string, unknown>[];
    assert.equal(layers.length, 1);
    assert.equal(layers[0]!.name, 'check');
    assert.equal(layers[0]!.type, 'contains');

    const execution = task.execution as Record<string, unknown>;
    assert.equal(execution.timeoutMs, 10000);
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset produces different hashes for different content', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suite1 = join(tempDir, 'suite1');
    const suite2 = join(tempDir, 'suite2');
    await mkdir(suite1, { recursive: true });
    await mkdir(suite2, { recursive: true });
    await writeTaskFile(suite1, 'task.yaml', MINIMAL_TASK_YAML);
    await writeTaskFile(suite2, 'task.yaml', SECOND_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result1 = await adapter.resolveDataset({ ref: 'dataset://suite1' });
    const result2 = await adapter.resolveDataset({ ref: 'dataset://suite2' });

    assert.notEqual(result1.datasetHash, result2.datasetHash);
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset supports .yml extension', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'yml-suite');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'task.yml', MINIMAL_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result = await adapter.resolveDataset({ ref: 'dataset://yml-suite' });

    assert.equal(result.tasks.length, 1);
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset keeps array scalar values that contain colon', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'url-suite');
    await mkdir(suiteDir, { recursive: true });
    await writeTaskFile(suiteDir, 'task.yaml', URL_TAG_TASK_YAML);

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result = await adapter.resolveDataset({ ref: 'dataset://url-suite' });

    const task = result.tasks[0] as Record<string, unknown>;
    const tags = task.tags as unknown[];
    assert.deepEqual(tags, ['http://example.com/resource']);
  } finally {
    await rm(tempDir, { recursive: true });
  }
});

test('resolveDataset uses stable tag by default when .tags.json exists', async () => {
  const tempDir = await createTempDatasetDir();
  try {
    const suiteDir = join(tempDir, 'suite');
    const stableDir = join(suiteDir, 'revisions', 'rev-stable-001');
    const nextDir = join(suiteDir, 'revisions', 'rev-next-001');
    await mkdir(stableDir, { recursive: true });
    await mkdir(nextDir, { recursive: true });
    await writeTaskFile(stableDir, 'task.yaml', MINIMAL_TASK_YAML);
    await writeTaskFile(nextDir, 'task.yaml', SECOND_TASK_YAML);
    await writeTaskFile(
      suiteDir,
      '.tags.json',
      JSON.stringify({
        stable: 'rev-stable-001',
        next: 'rev-next-001',
      }),
    );

    const adapter = createLocalTaskSourceAdapter({ datasetsRoot: tempDir });
    const result = await adapter.resolveDataset({
      ref: 'dataset://suite',
    });

    assert.equal(result.source.revision, 'rev-stable-001');
    const task = result.tasks[0] as Record<string, unknown>;
    assert.equal(task.id, 'test/basic-001');
  } finally {
    await rm(tempDir, { recursive: true });
  }
});
