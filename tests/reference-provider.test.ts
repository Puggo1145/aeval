import assert from 'node:assert/strict';
import test from 'node:test';

import { SCHEMA_VERSIONS } from '../src/core/contracts/schema-versions.js';
import { InMemoryProviderRegistry } from '../src/core/runtime/provider-registry.js';
import { registerReferenceProvider } from '../src/providers/index.js';

function createTestContext(overrides: Partial<Parameters<typeof callProvider>[0]> = {}) {
  return {
    taskId: 'task-1',
    trialIndex: 0,
    runName: 'test-run',
    runId: 'run-123',
    overrides: {},
    signal: AbortSignal.timeout(5000),
    ...overrides,
  };
}

function createRegistry() {
  const registry = new InMemoryProviderRegistry();
  registerReferenceProvider(registry);
  return registry;
}

async function callProvider(
  ctx: ReturnType<typeof createTestContext>,
  params: Record<string, unknown> = {},
) {
  const registry = createRegistry();
  const provider = registry.get('reference');
  assert.ok(provider, 'Reference provider should be registered');
  return provider(ctx, params);
}

test('registerReferenceProvider registers under "reference" id', () => {
  const registry = createRegistry();
  assert.ok(registry.has('reference'));
  assert.ok(registry.get('reference'));
});

test('reference provider returns valid ExecutionResult with output from params', async () => {
  const result = await callProvider(createTestContext(), { output: 'hello world' });

  assert.equal(result.schemaVersion, SCHEMA_VERSIONS.EXECUTION_RESULT);
  assert.equal(result.output, 'hello world');
  assert.ok(result.trace?.turns);
  assert.equal(result.trace.turns.length, 2);
  assert.equal(result.trace.turns[0]?.role, 'user');
  assert.equal(result.trace.turns[1]?.role, 'assistant');
  assert.equal(result.trace.turns[1]?.content, 'hello world');
});

test('reference provider defaults output to empty string when params.output is missing', async () => {
  const result = await callProvider(createTestContext(), {});

  assert.equal(result.output, '');
});

test('reference provider includes metrics with token estimates', async () => {
  const result = await callProvider(createTestContext(), { output: 'test output' });

  assert.ok(result.metrics);
  assert.equal(result.metrics.model, 'reference');
  assert.equal(result.metrics.latencyMs, 0);
  assert.ok(result.metrics.tokenUsage);
  assert.ok(typeof result.metrics.tokenUsage.input === 'number');
  assert.ok(typeof result.metrics.tokenUsage.output === 'number');
  assert.ok(typeof result.metrics.tokenUsage.total === 'number');
  assert.equal(
    result.metrics.tokenUsage.total,
    (result.metrics.tokenUsage.input ?? 0) + (result.metrics.tokenUsage.output ?? 0),
  );
});

test('reference provider passes through structuredOutput', async () => {
  const structured = { key: 'value', nested: { a: 1 } };
  const result = await callProvider(createTestContext(), {
    output: 'hello',
    structuredOutput: structured,
  });

  assert.deepEqual(result.structuredOutput, structured);
});

test('reference provider passes through outcome', async () => {
  const outcome = { success: true, score: 0.95 };
  const result = await callProvider(createTestContext(), {
    output: 'hello',
    outcome,
  });

  assert.deepEqual(result.outcome, outcome);
});

test('reference provider uses custom model and latencyMs from params', async () => {
  const result = await callProvider(createTestContext(), {
    output: 'hello',
    model: 'custom-model',
    latencyMs: 150,
  });

  assert.equal(result.metrics?.model, 'custom-model');
  assert.equal(result.metrics?.latencyMs, 150);
});

test('reference provider returns error result when signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const ctx = createTestContext({ signal: controller.signal });

  const result = await callProvider(ctx, { output: 'should not appear' });

  assert.ok(result.error);
  assert.equal(result.error.type, 'system');
  assert.equal(result.error.code, 'aborted');
  assert.equal(result.output, '');
});
