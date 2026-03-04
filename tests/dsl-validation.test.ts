import assert from 'node:assert/strict';
import test from 'node:test';

import { SCHEMA_VERSIONS } from '../src/core/contracts/index.js';
import { ValidationError } from '../src/core/errors/index.js';
import {
  assertExecutionResultSchemaVersion,
  validateExperimentDefinition,
  validateTaskDefinition,
  validateTaskDefinitions,
} from '../src/core/validation/index.js';

const VALID_PROVIDER_ID = 'chat-agent.board-qa';

function createValidTaskInput() {
  return {
    schemaVersion: SCHEMA_VERSIONS.TASK,
    id: 'chat-agent/basic-001',
    provider: {
      id: VALID_PROVIDER_ID,
      params: {
        userMessage: 'hello',
      },
    },
    graders: {
      strategy: 'ALL',
      layers: [
        {
          name: 'contains keyword',
          type: 'contains',
        },
      ],
    },
    execution: {
      timeoutMs: 30000,
    },
  };
}

function createValidExperimentInput() {
  return {
    schemaVersion: SCHEMA_VERSIONS.EXPERIMENT,
    name: 'smoke-run',
    taskSource: {
      adapter: 'local-task-source',
    },
    runs: [
      {
        name: 'baseline',
      },
    ],
    maxConcurrency: 2,
    resultStore: {
      adapter: 'local-result-store',
    },
  };
}

function expectValidationField(error: unknown, expectedField: string): true {
  assert.ok(error instanceof ValidationError);
  const field = error.details?.field;
  assert.equal(field, expectedField);
  return true;
}

test('validateTaskDefinition accepts a valid task', () => {
  const task = validateTaskDefinition(createValidTaskInput(), {
    isProviderRegistered: (providerId) => providerId === VALID_PROVIDER_ID,
  });

  assert.equal(task.schemaVersion, SCHEMA_VERSIONS.TASK);
  assert.equal(task.id, 'chat-agent/basic-001');
  assert.equal(task.provider.id, VALID_PROVIDER_ID);
});

test('validateTaskDefinition rejects wrapped task input', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          task: createValidTaskInput(),
        },
        {
          isProviderRegistered: (providerId) => providerId === VALID_PROVIDER_ID,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.schemaVersion'),
  );
});

test('validateTaskDefinition fails when schemaVersion is unsupported', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          schemaVersion: 'task.v2',
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.schemaVersion'),
  );
});

test('validateTaskDefinition fails when provider cannot be resolved', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(createValidTaskInput(), {
        isProviderRegistered: () => false,
        listProviderIds: () => ['provider-a'],
      }),
    (error: unknown) => expectValidationField(error, 'task.provider.id'),
  );
});

test('validateTaskDefinition fails when grader layers are empty', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          graders: {
            strategy: 'ALL',
            layers: [],
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.graders.layers'),
  );
});

test('validateTaskDefinition fails when WEIGHTED strategy has no passThreshold', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          graders: {
            strategy: 'WEIGHTED',
            layers: [
              {
                name: 'contains keyword',
                type: 'contains',
              },
            ],
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.graders.passThreshold'),
  );
});

test('validateTaskDefinition fails when WEIGHTED strategy has non-positive passThreshold', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          graders: {
            strategy: 'WEIGHTED',
            passThreshold: -0.1,
            layers: [
              {
                name: 'contains keyword',
                type: 'contains',
              },
            ],
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.graders.passThreshold'),
  );
});

test('validateTaskDefinition fails when WEIGHTED strategy passThreshold is NaN', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          graders: {
            strategy: 'WEIGHTED',
            passThreshold: Number.NaN,
            layers: [
              {
                name: 'contains keyword',
                type: 'contains',
              },
            ],
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.graders.passThreshold'),
  );
});

test('validateTaskDefinition fails when WEIGHTED strategy passThreshold is Infinity', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          graders: {
            strategy: 'WEIGHTED',
            passThreshold: Number.POSITIVE_INFINITY,
            layers: [
              {
                name: 'contains keyword',
                type: 'contains',
              },
            ],
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.graders.passThreshold'),
  );
});

test('validateTaskDefinition fails when grader layer weight is non-positive', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          graders: {
            strategy: 'ALL',
            layers: [
              {
                name: 'contains keyword',
                type: 'contains',
                weight: 0,
              },
            ],
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.graders.layers[0].weight'),
  );
});

test('validateTaskDefinition fails when execution timeoutMs is invalid', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          execution: {
            timeoutMs: 0,
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.execution.timeoutMs'),
  );
});

test('validateTaskDefinition fails when execution timeoutMs is not an integer', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          execution: {
            timeoutMs: 1000.5,
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.execution.timeoutMs'),
  );
});

test('validateTaskDefinition keeps metadata fields when values are valid strings', () => {
  const task = validateTaskDefinition(
    {
      ...createValidTaskInput(),
      desc: 'task description',
      category: 'chat-agent',
      capability: 'board-qa',
      tier: 'L1',
      difficulty: 'easy',
      tags: ['smoke', 'chat-agent'],
      lifecycle: {
        status: 'active',
      },
    },
    {
      isProviderRegistered: () => true,
    },
  );

  assert.equal(task.desc, 'task description');
  assert.equal(task.category, 'chat-agent');
  assert.equal(task.capability, 'board-qa');
  assert.equal(task.tier, 'L1');
  assert.equal(task.difficulty, 'easy');
  assert.deepEqual(task.tags, ['smoke', 'chat-agent']);
  assert.deepEqual(task.lifecycle, { status: 'active' });
});

test('validateTaskDefinition fails when metadata field is not a string', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          category: 42,
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.category'),
  );
});

test('validateTaskDefinition fails when tags includes non-string values', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          tags: ['valid-tag', 1],
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.tags'),
  );
});

test('validateTaskDefinition fails when lifecycle is not an object', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          lifecycle: 'active',
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.lifecycle'),
  );
});

test('validateTaskDefinition fails when unknown top-level field exists', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          unexpectedTopLevel: true,
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task'),
  );
});

test('validateTaskDefinition fails when unknown nested field exists', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinition(
        {
          ...createValidTaskInput(),
          provider: {
            ...createValidTaskInput().provider,
            extra: 'not-allowed',
          },
        },
        {
          isProviderRegistered: () => true,
        },
      ),
    (error: unknown) => expectValidationField(error, 'task.provider'),
  );
});

test('validateTaskDefinitions accepts task list with unique ids', () => {
  const tasks = validateTaskDefinitions(
    [
      createValidTaskInput(),
      {
        ...createValidTaskInput(),
        id: 'chat-agent/basic-002',
      },
    ],
    {
      isProviderRegistered: () => true,
      datasetRevision: 'rev-2026-02-28-001',
    },
  );

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]?.id, 'chat-agent/basic-001');
  assert.equal(tasks[1]?.id, 'chat-agent/basic-002');
});

test('validateTaskDefinitions fails when task.id is duplicated in one dataset revision', async () => {
  await assert.rejects(
    async () =>
      validateTaskDefinitions(
        [
          createValidTaskInput(),
          {
            ...createValidTaskInput(),
            provider: {
              ...createValidTaskInput().provider,
              params: {
                userMessage: 'duplicate',
              },
            },
          },
        ],
        {
          isProviderRegistered: () => true,
          datasetRevision: 'rev-2026-02-28-001',
        },
      ),
    (error: unknown) => expectValidationField(error, 'tasks[1].id'),
  );
});

test('validateExperimentDefinition accepts a valid experiment', () => {
  const experiment = validateExperimentDefinition(createValidExperimentInput());

  assert.equal(experiment.schemaVersion, SCHEMA_VERSIONS.EXPERIMENT);
  assert.equal(experiment.name, 'smoke-run');
  assert.equal(experiment.runs.length, 1);
});

test('validateExperimentDefinition rejects wrapped experiment input', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        experiment: createValidExperimentInput(),
      }),
    (error: unknown) => expectValidationField(error, 'experiment.schemaVersion'),
  );
});

test('validateExperimentDefinition fails when schemaVersion is unsupported', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        schemaVersion: 'experiment.v2',
      }),
    (error: unknown) => expectValidationField(error, 'experiment.schemaVersion'),
  );
});

test('validateExperimentDefinition fails when taskSource.adapter is missing', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        taskSource: {
          adapter: '',
        },
      }),
    (error: unknown) => expectValidationField(error, 'experiment.taskSource.adapter'),
  );
});

test('validateExperimentDefinition fails when maxConcurrency is invalid', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        maxConcurrency: 0,
      }),
    (error: unknown) => expectValidationField(error, 'experiment.maxConcurrency'),
  );
});

test('validateExperimentDefinition fails when maxConcurrency is not an integer', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        maxConcurrency: 2.5,
      }),
    (error: unknown) => expectValidationField(error, 'experiment.maxConcurrency'),
  );
});

test('validateExperimentDefinition fails when timeoutMs is not an integer', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        timeoutMs: 1000.1,
      }),
    (error: unknown) => expectValidationField(error, 'experiment.timeoutMs'),
  );
});

test('validateExperimentDefinition fails when runs are missing', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        runs: [],
      }),
    (error: unknown) => expectValidationField(error, 'experiment.runs'),
  );
});

test('validateExperimentDefinition fails when run names are duplicated', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        runs: [{ name: 'same-run' }, { name: 'same-run' }],
      }),
    (error: unknown) => expectValidationField(error, 'experiment.runs[1].name'),
  );
});

test('validateExperimentDefinition fails when unknown top-level field exists', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        extraTopLevel: true,
      }),
    (error: unknown) => expectValidationField(error, 'experiment'),
  );
});

test('validateExperimentDefinition fails when unknown nested field exists', async () => {
  await assert.rejects(
    async () =>
      validateExperimentDefinition({
        ...createValidExperimentInput(),
        runs: [
          {
            name: 'baseline',
            extra: true,
          },
        ],
      }),
    (error: unknown) => expectValidationField(error, 'experiment.runs[0]'),
  );
});

test('schema version gate fails fast for non-v1 execution result versions', async () => {
  await assert.rejects(
    async () => assertExecutionResultSchemaVersion('execution-result.v2'),
    (error: unknown) => expectValidationField(error, 'executionResult.schemaVersion'),
  );
});
