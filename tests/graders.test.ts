import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionResult } from '../src/core/contracts/execution.js';
import { SCHEMA_VERSIONS } from '../src/core/contracts/schema-versions.js';
import { InMemoryGraderRegistry } from '../src/core/runtime/grader-registry.js';
import { contains } from '../src/graders/builtins/contains.js';
import { exactMatch } from '../src/graders/builtins/exact-match.js';
import { jsonSchema } from '../src/graders/builtins/json-schema.js';
import { latencyThreshold } from '../src/graders/builtins/latency-threshold.js';
import { lengthCheck } from '../src/graders/builtins/length-check.js';
import { outcomeCheck } from '../src/graders/builtins/outcome-check.js';
import { regex } from '../src/graders/builtins/regex.js';
import { tokenBudget } from '../src/graders/builtins/token-budget.js';
import { toolCalls } from '../src/graders/builtins/tool-calls.js';
import { transcript } from '../src/graders/builtins/transcript.js';
import type { JudgeProvider } from '../src/graders/llm/judge-provider.js';
import { createLlmJudgeGrader } from '../src/graders/llm/llm-judge.js';
import { registerBuiltinGraders } from '../src/graders/register-builtins.js';

// --- Test helpers ---

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: '',
    ...overrides,
  };
}

// ==================== exact-match ====================

test('exact-match: passes on exact match', async () => {
  const r = await exactMatch(makeResult({ output: 'hello world' }), { expected: 'hello world' });
  assert.equal(r.pass, true);
});

test('exact-match: fails on mismatch', async () => {
  const r = await exactMatch(makeResult({ output: 'hello' }), { expected: 'world' });
  assert.equal(r.pass, false);
});

test('exact-match: case insensitive', async () => {
  const r = await exactMatch(makeResult({ output: 'Hello World' }), {
    expected: 'hello world',
    caseSensitive: false,
  });
  assert.equal(r.pass, true);
});

test('exact-match: case sensitive by default', async () => {
  const r = await exactMatch(makeResult({ output: 'Hello' }), { expected: 'hello' });
  assert.equal(r.pass, false);
});

test('exact-match: trim option', async () => {
  const r = await exactMatch(makeResult({ output: '  hello  ' }), {
    expected: 'hello',
    trim: true,
  });
  assert.equal(r.pass, true);
});

test('exact-match: fails if expected is not a string', async () => {
  const r = await exactMatch(makeResult(), { expected: 123 });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes("'expected'"));
});

// ==================== contains ====================

test('contains: mustInclude passes', async () => {
  const r = await contains(makeResult({ output: 'React Server Components are great' }), {
    mustInclude: [{ pattern: 'Server Components', caseSensitive: false }],
  });
  assert.equal(r.pass, true);
});

test('contains: mustInclude fails when missing', async () => {
  const r = await contains(makeResult({ output: 'nothing here' }), {
    mustInclude: [{ pattern: 'Server Components' }],
  });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Missing required'));
});

test('contains: mustNotInclude passes', async () => {
  const r = await contains(makeResult({ output: 'all good' }), {
    mustNotInclude: [{ pattern: 'error' }],
  });
  assert.equal(r.pass, true);
});

test('contains: mustNotInclude fails', async () => {
  const r = await contains(makeResult({ output: 'I cannot find it' }), {
    mustNotInclude: [{ pattern: 'cannot find', caseSensitive: false }],
  });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('forbidden'));
});

test('contains: fails when no config provided', async () => {
  const r = await contains(makeResult(), {});
  assert.equal(r.pass, false);
});

// ==================== regex ====================

test('regex: mustMatch passes', async () => {
  const r = await regex(makeResult({ output: 'The answer is 42' }), {
    mustMatch: [{ pattern: '\\d+' }],
  });
  assert.equal(r.pass, true);
});

test('regex: mustMatch fails', async () => {
  const r = await regex(makeResult({ output: 'no numbers' }), {
    mustMatch: [{ pattern: '\\d+' }],
  });
  assert.equal(r.pass, false);
});

test('regex: mustNotMatch passes', async () => {
  const r = await regex(makeResult({ output: 'clean output' }), {
    mustNotMatch: [{ pattern: 'error', flags: 'i' }],
  });
  assert.equal(r.pass, true);
});

test('regex: mustNotMatch fails', async () => {
  const r = await regex(makeResult({ output: 'ERROR occurred' }), {
    mustNotMatch: [{ pattern: 'error', flags: 'i' }],
  });
  assert.equal(r.pass, false);
});

test('regex: both mustMatch and mustNotMatch', async () => {
  const r = await regex(makeResult({ output: 'result: 42' }), {
    mustMatch: [{ pattern: '\\d+' }],
    mustNotMatch: [{ pattern: 'error', flags: 'i' }],
  });
  assert.equal(r.pass, true);
});

test('regex: invalid pattern returns grader fail instead of throwing', async () => {
  const r = await regex(makeResult({ output: 'anything' }), {
    mustMatch: [{ pattern: '[' }],
  });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid grader config'));
});

// ==================== json-schema ====================

test('json-schema: valid object', async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: { name: 'Alice', age: 30 } }), {
    schema: {
      type: 'object',
      required: ['name', 'age'],
      properties: {
        name: { type: 'string' },
        age: { type: 'number', minimum: 0 },
      },
    },
  });
  assert.equal(r.pass, true);
});

test('json-schema: missing required field', async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: { name: 'Alice' } }), {
    schema: {
      type: 'object',
      required: ['name', 'age'],
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    },
  });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes("'age'"));
});

test('json-schema: type mismatch', async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: 'not an object' }), {
    schema: { type: 'object' },
  });
  assert.equal(r.pass, false);
});

test('json-schema: enum validation', async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: { status: 'active' } }), {
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive'] },
      },
    },
  });
  assert.equal(r.pass, true);
});

test('json-schema: array items validation', async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: [1, 2, 'three'] }), {
    schema: {
      type: 'array',
      items: { type: 'number' },
    },
  });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('number'));
});

test('json-schema: undefined structuredOutput', async () => {
  const r = await jsonSchema(makeResult(), { schema: { type: 'object' } });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('undefined'));
});

test('json-schema: string constraints', async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: { code: 'AB' } }), {
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', minLength: 3, maxLength: 5 },
      },
    },
  });
  assert.equal(r.pass, false);
});

test('json-schema: additionalProperties false', async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: { name: 'Alice', extra: true } }), {
    schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    },
  });
  assert.equal(r.pass, false);
});

test('json-schema: invalid pattern returns grader fail instead of throwing', async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: { code: 'ABC' } }), {
    schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          pattern: '[',
        },
      },
    },
  });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid JSON Schema'));
});

test("json-schema: allows property named 'pattern'", async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: { pattern: 'ABC' } }), {
    schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
        },
      },
      required: ['pattern'],
    },
  });
  assert.equal(r.pass, true);
});

test("json-schema: allows literal object with key named 'pattern' inside const", async () => {
  const r = await jsonSchema(makeResult({ structuredOutput: { pattern: 123 } }), {
    schema: {
      const: {
        pattern: 123,
      },
    },
  });
  assert.equal(r.pass, true);
});

// ==================== length-check ====================

test('length-check: within bounds', async () => {
  const r = await lengthCheck(makeResult({ output: 'hello' }), { min: 1, max: 10 });
  assert.equal(r.pass, true);
});

test('length-check: too short', async () => {
  const r = await lengthCheck(makeResult({ output: 'hi' }), { min: 5 });
  assert.equal(r.pass, false);
});

test('length-check: too long', async () => {
  const r = await lengthCheck(makeResult({ output: 'a'.repeat(100) }), { max: 50 });
  assert.equal(r.pass, false);
});

test('length-check: fails with no config', async () => {
  const r = await lengthCheck(makeResult(), {});
  assert.equal(r.pass, false);
});

test('length-check: fails when min is greater than max', async () => {
  const r = await lengthCheck(makeResult({ output: 'hello' }), { min: 10, max: 5 });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes("Field 'min' must be less than or equal to 'max'."));
});

// ==================== tool-calls ====================

test('tool-calls: required tool present', async () => {
  const r = await toolCalls(
    makeResult({
      trace: {
        turns: [{ role: 'assistant', content: '', toolCalls: [{ tool: 'searchBoards' }] }],
      },
    }),
    { required: [{ tool: 'searchBoards' }] },
  );
  assert.equal(r.pass, true);
});

test('tool-calls: required tool missing', async () => {
  const r = await toolCalls(makeResult({ trace: { turns: [] } }), {
    required: [{ tool: 'searchBoards' }],
  });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('searchBoards'));
});

test('tool-calls: forbidden tool found', async () => {
  const r = await toolCalls(
    makeResult({
      trace: {
        turns: [{ role: 'assistant', content: '', toolCalls: [{ tool: 'createBoard' }] }],
      },
    }),
    { forbidden: [{ tool: 'createBoard' }] },
  );
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('createBoard'));
});

test('tool-calls: maxCalls exceeded', async () => {
  const r = await toolCalls(
    makeResult({
      trace: {
        turns: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ tool: 'a' }, { tool: 'b' }, { tool: 'c' }],
          },
        ],
      },
    }),
    { maxCalls: 2 },
  );
  assert.equal(r.pass, false);
});

test('tool-calls: no trace returns pass for forbidden-only check', async () => {
  const r = await toolCalls(makeResult(), { forbidden: [{ tool: 'createBoard' }] });
  assert.equal(r.pass, true);
});

test('tool-calls: maxCalls as string fails config validation', async () => {
  const r = await toolCalls(makeResult(), { maxCalls: '2' });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid grader config'));
});

test('tool-calls: negative minCalls fails config validation', async () => {
  const r = await toolCalls(makeResult(), { minCalls: -1 });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid grader config'));
});

test('tool-calls: NaN maxCalls fails config validation', async () => {
  const r = await toolCalls(makeResult(), { maxCalls: Number.NaN });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid grader config'));
});

test('tool-calls: empty config fails', async () => {
  const r = await toolCalls(makeResult(), {});
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('must provide'));
});

// ==================== transcript ====================

test('transcript: turn count within bounds', async () => {
  const r = await transcript(
    makeResult({
      trace: {
        turns: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      },
    }),
    { minTurns: 1, maxTurns: 5 },
  );
  assert.equal(r.pass, true);
});

test('transcript: too many turns', async () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({
    role: (i % 3 === 0 ? 'system' : i % 2 === 0 ? 'user' : 'assistant') as
      | 'system'
      | 'user'
      | 'assistant',
    content: `msg ${i}`,
  }));
  const r = await transcript(makeResult({ trace: { turns } }), { maxTurns: 5 });
  assert.equal(r.pass, false);
});

test('transcript: accepts system role in mustStartWith', async () => {
  const r = await transcript(
    makeResult({
      trace: {
        turns: [
          { role: 'system', content: 'You are concise.' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      },
    }),
    { mustStartWith: 'system' },
  );
  assert.equal(r.pass, true);
});

test('transcript: mustStartWith', async () => {
  const r = await transcript(
    makeResult({
      trace: { turns: [{ role: 'assistant', content: 'hi' }] },
    }),
    { mustStartWith: 'user' },
  );
  assert.equal(r.pass, false);
});

test('transcript: mustStartWith fails when transcript is empty', async () => {
  const r = await transcript(makeResult({ trace: { turns: [] } }), { mustStartWith: 'user' });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('First turn is missing'));
});

test('transcript: mustEndWith', async () => {
  const r = await transcript(
    makeResult({
      trace: {
        turns: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
      },
    }),
    { mustEndWith: 'assistant' },
  );
  assert.equal(r.pass, true);
});

test('transcript: mustEndWith fails when transcript is empty', async () => {
  const r = await transcript(makeResult({ trace: { turns: [] } }), { mustEndWith: 'assistant' });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Last turn is missing'));
});

test('transcript: maxConsecutiveSameRole', async () => {
  const r = await transcript(
    makeResult({
      trace: {
        turns: [
          { role: 'user', content: 'a' },
          { role: 'user', content: 'b' },
          { role: 'user', content: 'c' },
          { role: 'assistant', content: 'd' },
        ],
      },
    }),
    { maxConsecutiveSameRole: 2 },
  );
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('consecutive'));
});

test('transcript: string minTurns fails config validation', async () => {
  const r = await transcript(makeResult(), { minTurns: '2' });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid grader config'));
});

test('transcript: negative maxTurns fails config validation', async () => {
  const r = await transcript(makeResult(), { maxTurns: -1 });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid grader config'));
});

test('transcript: Infinity maxConsecutiveSameRole fails config validation', async () => {
  const r = await transcript(makeResult(), { maxConsecutiveSameRole: Infinity });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid grader config'));
});

test('transcript: invalid role fails config validation', async () => {
  const r = await transcript(makeResult(), { mustStartWith: 'tool' });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('Invalid grader config'));
});

test('transcript: minTurns greater than maxTurns fails config validation', async () => {
  const r = await transcript(makeResult(), { minTurns: 5, maxTurns: 1 });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('minTurns'));
});

// ==================== outcome-check ====================

test('outcome-check: matching outcome', async () => {
  const r = await outcomeCheck(
    makeResult({ outcome: { boardModified: false, materialsCreated: 0 } }),
    { expect: { boardModified: false, materialsCreated: 0 } },
  );
  assert.equal(r.pass, true);
});

test('outcome-check: mismatched outcome', async () => {
  const r = await outcomeCheck(makeResult({ outcome: { boardModified: true } }), {
    expect: { boardModified: false },
  });
  assert.equal(r.pass, false);
});

test('outcome-check: no outcome', async () => {
  const r = await outcomeCheck(makeResult(), { expect: { boardModified: false } });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('no outcome'));
});

test('outcome-check: nested value check', async () => {
  const r = await outcomeCheck(makeResult({ outcome: { data: { nested: [1, 2, 3] } } }), {
    expect: { data: { nested: [1, 2, 3] } },
  });
  assert.equal(r.pass, true);
});

// ==================== latency-threshold ====================

test('latency-threshold: within threshold', async () => {
  const r = await latencyThreshold(makeResult({ metrics: { latencyMs: 500 } }), { maxMs: 1000 });
  assert.equal(r.pass, true);
});

test('latency-threshold: exceeds threshold', async () => {
  const r = await latencyThreshold(makeResult({ metrics: { latencyMs: 1500 } }), { maxMs: 1000 });
  assert.equal(r.pass, false);
});

test('latency-threshold: no latency data', async () => {
  const r = await latencyThreshold(makeResult({ metrics: {} }), { maxMs: 1000 });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('not available'));
});

test('latency-threshold: invalid config', async () => {
  const r = await latencyThreshold(makeResult(), { maxMs: -1 });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('maxMs'));
});

// ==================== token-budget ====================

test('token-budget: within budget', async () => {
  const r = await tokenBudget(
    makeResult({ metrics: { tokenUsage: { input: 100, output: 50, total: 150 } } }),
    { maxTotal: 200 },
  );
  assert.equal(r.pass, true);
});

test('token-budget: total exceeds budget', async () => {
  const r = await tokenBudget(
    makeResult({ metrics: { tokenUsage: { input: 100, output: 200, total: 300 } } }),
    { maxTotal: 250 },
  );
  assert.equal(r.pass, false);
});

test('token-budget: input exceeds budget', async () => {
  const r = await tokenBudget(
    makeResult({ metrics: { tokenUsage: { input: 500, output: 50, total: 550 } } }),
    { maxInput: 200 },
  );
  assert.equal(r.pass, false);
});

test('token-budget: output exceeds budget', async () => {
  const r = await tokenBudget(
    makeResult({ metrics: { tokenUsage: { input: 50, output: 500, total: 550 } } }),
    { maxOutput: 200 },
  );
  assert.equal(r.pass, false);
});

test('token-budget: no tokenUsage', async () => {
  const r = await tokenBudget(makeResult({ metrics: {} }), { maxTotal: 200 });
  assert.equal(r.pass, false);
});

test('token-budget: no config', async () => {
  const r = await tokenBudget(makeResult(), {});
  assert.equal(r.pass, false);
});

test('token-budget: invalid maxTotal config type fails', async () => {
  const r = await tokenBudget(
    makeResult({ metrics: { tokenUsage: { input: 100, output: 100, total: 200 } } }),
    { maxTotal: '200' },
  );
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes("'maxTotal'"));
});

test('token-budget: negative maxInput config fails', async () => {
  const r = await tokenBudget(
    makeResult({ metrics: { tokenUsage: { input: 100, output: 100, total: 200 } } }),
    { maxInput: -1 },
  );
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes("'maxInput'"));
});

test('token-budget: maxTotal requires usage.total', async () => {
  const r = await tokenBudget(
    makeResult({ metrics: { tokenUsage: { input: 100, output: 100 } } }),
    { maxTotal: 300 },
  );
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('tokenUsage.total'));
});

test('token-budget: maxInput requires usage.input', async () => {
  const r = await tokenBudget(
    makeResult({ metrics: { tokenUsage: { output: 100, total: 100 } } }),
    { maxInput: 300 },
  );
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('tokenUsage.input'));
});

test('token-budget: maxOutput requires usage.output', async () => {
  const r = await tokenBudget(makeResult({ metrics: { tokenUsage: { input: 100, total: 100 } } }), {
    maxOutput: 300,
  });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('tokenUsage.output'));
});

// ==================== llm-judge ====================

test('llm-judge: passes with mock judge', async () => {
  const mockJudge: JudgeProvider = {
    evaluate: async () => ({
      pass: true,
      score: 0.95,
      reason: 'Answer is faithful to context.',
      label: 'PASS',
    }),
  };
  const grader = createLlmJudgeGrader(mockJudge);
  const r = await grader(makeResult({ output: 'React Server Components reduce bundle size.' }), {
    dimension: 'faithfulness',
    rubric: 'PASS if grounded in context.',
  });
  assert.equal(r.pass, true);
  assert.equal(r.score, 0.95);
  assert.equal(r.meta?.label, 'PASS');
  assert.equal(r.meta?.dimension, 'faithfulness');
});

test('llm-judge: fails with mock judge', async () => {
  const mockJudge: JudgeProvider = {
    evaluate: async () => ({
      pass: false,
      score: 0.2,
      reason: 'Answer contains unsupported claims.',
      label: 'FAIL',
    }),
  };
  const grader = createLlmJudgeGrader(mockJudge);
  const r = await grader(makeResult({ output: 'made up facts' }), {
    dimension: 'faithfulness',
    rubric: 'PASS if grounded in context.',
  });
  assert.equal(r.pass, false);
  assert.equal(r.meta?.label, 'FAIL');
});

test('llm-judge: resolves contextFrom path', async () => {
  let receivedInput: unknown;
  const mockJudge: JudgeProvider = {
    evaluate: async (input) => {
      receivedInput = input;
      return { pass: true, reason: 'ok' };
    },
  };
  const grader = createLlmJudgeGrader(mockJudge);
  await grader(
    makeResult({
      output: 'answer',
      outcome: { boardContent: 'some board content' },
    }),
    {
      dimension: 'faithfulness',
      rubric: 'PASS if grounded.',
      contextFrom: 'outcome.boardContent',
    },
  );
  assert.equal((receivedInput as { context: unknown }).context, 'some board content');
});

test('llm-judge: missing dimension fails', async () => {
  const mockJudge: JudgeProvider = {
    evaluate: async () => ({ pass: true, reason: 'ok' }),
  };
  const grader = createLlmJudgeGrader(mockJudge);
  const r = await grader(makeResult(), { rubric: 'some rubric' });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('dimension'));
});

test('llm-judge: missing rubric fails', async () => {
  const mockJudge: JudgeProvider = {
    evaluate: async () => ({ pass: true, reason: 'ok' }),
  };
  const grader = createLlmJudgeGrader(mockJudge);
  const r = await grader(makeResult(), { dimension: 'faithfulness' });
  assert.equal(r.pass, false);
  assert.ok(r.reason.includes('rubric'));
});

// ==================== registerBuiltinGraders ====================

test('registerBuiltinGraders: registers all 10 built-in graders', () => {
  const registry = new InMemoryGraderRegistry();
  registerBuiltinGraders(registry);
  const list = registry.list();
  const expected = [
    'exact-match',
    'contains',
    'regex',
    'json-schema',
    'length-check',
    'tool-calls',
    'transcript',
    'outcome-check',
    'latency-threshold',
    'token-budget',
  ];
  for (const name of expected) {
    assert.ok(list.includes(name), `Missing grader: ${name}`);
  }
  // llm-judge should NOT be registered without judgeProvider
  assert.ok(!list.includes('llm-judge'));
});

test('registerBuiltinGraders: registers llm-judge when judgeProvider provided', () => {
  const registry = new InMemoryGraderRegistry();
  const mockJudge: JudgeProvider = {
    evaluate: async () => ({ pass: true, reason: 'ok' }),
  };
  registerBuiltinGraders(registry, { judgeProvider: mockJudge });
  assert.ok(registry.has('llm-judge'));
  assert.equal(registry.list().length, 11);
});

test('custom graders work via GraderRegistry.register()', () => {
  const registry = new InMemoryGraderRegistry();
  registerBuiltinGraders(registry);
  // Custom grader registration
  registry.register('my-custom', async (result) => ({
    pass: result.output.includes('success'),
    reason: 'custom check',
  }));
  assert.ok(registry.has('my-custom'));
  assert.equal(registry.list().length, 11); // 10 builtins + 1 custom
});
