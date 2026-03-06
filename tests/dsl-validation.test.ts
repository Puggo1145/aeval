import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSuiteDefinition, validateTaskDefinition } from '../src/core/validation/index.js';

function expectValidationField(error: unknown, field: string): boolean {
  assert.ok(error instanceof Error);
  const details =
    'details' in error && typeof error.details === 'object' ? (error.details as { field?: unknown }) : {};
  assert.equal(details.field, field);
  return true;
}

function createValidSuiteInput() {
  return {
    schemaVersion: 'suite.v1',
    id: 'basic-llm',
    name: 'Basic LLM',
    discover: ['datasets/**/*.yaml'],
  };
}

function createValidTaskInput() {
  return {
    schemaVersion: 'task.v1',
    id: 'basic-llm/task-001',
    provider: {
      id: 'reference',
      runs: [
        {
          name: 'mini',
          params: {
            prompt: 'hello',
          },
        },
      ],
    },
    graders: {
      strategy: 'ALL',
      layers: [
        {
          name: 'contains hello',
          type: 'contains',
          config: {
            mustInclude: [{ pattern: 'hello', caseSensitive: false }],
          },
        },
      ],
    },
    execution: {
      timeoutMs: 1000,
      retryOnError: 0,
      trialsPerTask: 2,
      maxConcurrency: 3,
    },
  };
}

test('validateSuiteDefinition accepts a valid suite document', () => {
  const suite = validateSuiteDefinition(createValidSuiteInput());

  assert.equal(suite.schemaVersion, 'suite.v1');
  assert.equal(suite.id, 'basic-llm');
  assert.deepEqual(suite.discover, ['datasets/**/*.yaml']);
});

test('validateSuiteDefinition rejects unknown fields', async () => {
  await assert.rejects(
    async () =>
      validateSuiteDefinition({
        ...createValidSuiteInput(),
        extra: true,
      }),
    (error: unknown) => expectValidationField(error, 'suite'),
  );
});

test('validateSuiteDefinition rejects empty discover patterns', async () => {
  await assert.rejects(
    async () =>
      validateSuiteDefinition({
        ...createValidSuiteInput(),
        discover: [],
      }),
    (error: unknown) => expectValidationField(error, 'suite.discover'),
  );
});

test('validateTaskDefinition accepts provider runs and execution.maxConcurrency', () => {
  const task = validateTaskDefinition(createValidTaskInput());

  assert.equal(task.provider.runs.length, 1);
  assert.equal(task.provider.runs[0]?.name, 'mini');
  assert.equal(task.execution.maxConcurrency, 3);
});

test('validateTaskDefinition rejects duplicate provider run names', async () => {
  const input = createValidTaskInput();
  input.provider.runs.push({
    name: 'mini',
    params: {
      prompt: 'again',
    },
  });

  await assert.rejects(
    async () => validateTaskDefinition(input),
    (error: unknown) => expectValidationField(error, 'task.provider.runs[1].name'),
  );
});

test('validateTaskDefinition rejects non-object run params', async () => {
  const input = createValidTaskInput();
  input.provider.runs[0] = {
    name: 'mini',
    params: 'hello' as unknown as Record<string, unknown>,
  };

  await assert.rejects(
    async () => validateTaskDefinition(input),
    (error: unknown) => expectValidationField(error, 'task.provider.runs[0].params'),
  );
});

test('validateTaskDefinition rejects invalid execution.maxConcurrency', async () => {
  const input = createValidTaskInput();
  input.execution.maxConcurrency = 0;

  await assert.rejects(
    async () => validateTaskDefinition(input),
    (error: unknown) => expectValidationField(error, 'task.execution.maxConcurrency'),
  );
});
