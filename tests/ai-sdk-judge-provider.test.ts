import assert from 'node:assert/strict';
import test from 'node:test';
import type { LanguageModel } from 'ai';
import {
  type AiSdkJudgeProviderDependencies,
  createAiSdkJudgeProvider,
} from '../packages/graders/src/llm/ai-sdk-judge-provider.js';

function createMockModel(modelId = 'gpt-4.1-mini'): LanguageModel {
  return { modelId } as unknown as LanguageModel;
}

function createDeps(
  overrides: Partial<AiSdkJudgeProviderDependencies> = {},
): AiSdkJudgeProviderDependencies {
  return {
    generateText: (async () => ({
      output: {
        summary: 'All assertions passed.',
        assertions: [
          {
            assertion: 'The answer addresses the request.',
            pass: true,
            reason: 'It does.',
          },
        ],
      },
    })) as unknown as AiSdkJudgeProviderDependencies['generateText'],
    ...overrides,
  };
}

test('createAiSdkJudgeProvider: selects model by judge profile', async () => {
  let capturedModel: unknown;
  const defaultModel = createMockModel('gpt-4.1-mini');
  const provider = createAiSdkJudgeProvider(
    {
      profiles: {
        default: defaultModel,
      },
    },
    createDeps({
      generateText: (async ({ model }: { model: unknown }) => {
        capturedModel = model;
        return {
          output: {
            summary: 'All assertions passed.',
            assertions: [
              {
                assertion: 'The answer addresses the request.',
                pass: true,
                reason: 'It does.',
              },
            ],
          },
        };
      }) as unknown as AiSdkJudgeProviderDependencies['generateText'],
    }),
  );

  const result = await provider.evaluate({
    output: 'Paris is the capital of France.',
    rubric: 'Pass if correct.',
    assertions: ['The answer addresses the request.'],
    dimension: 'correctness',
    judge: {
      profile: 'default',
    },
  });

  assert.equal(capturedModel, defaultModel);
  assert.equal(result.profile, 'default');
  assert.equal(result.model, 'gpt-4.1-mini');
  assert.equal(result.score, 1);
});

test('createAiSdkJudgeProvider: supports custom systemPrompt and buildPrompt', async () => {
  let capturedSystem = '';
  let capturedPrompt = '';
  const provider = createAiSdkJudgeProvider(
    {
      profiles: {
        strict: createMockModel('gpt-4.1-mini'),
      },
    },
    {
      systemPrompt: (input) => `custom system for ${input.dimension}`,
      buildPrompt: (input) => `custom prompt for ${input.judge.profile}: ${input.output}`,
    },
    createDeps({
      generateText: (async ({ system, prompt }: { system?: unknown; prompt?: unknown }) => {
        capturedSystem = system as string;
        capturedPrompt = prompt as string;
        return {
          output: {
            summary: 'All assertions passed.',
            assertions: [
              {
                assertion: 'The answer addresses the request.',
                pass: true,
                reason: 'It does.',
              },
            ],
          },
        };
      }) as unknown as AiSdkJudgeProviderDependencies['generateText'],
    }),
  );

  await provider.evaluate({
    output: 'Paris is the capital of France.',
    rubric: 'Pass if correct.',
    assertions: ['The answer addresses the request.'],
    dimension: 'correctness',
    judge: {
      profile: 'strict',
    },
  });

  assert.equal(capturedSystem, 'custom system for correctness');
  assert.equal(capturedPrompt, 'custom prompt for strict: Paris is the capital of France.');
});

test('createAiSdkJudgeProvider: unknown profile fails', async () => {
  const provider = createAiSdkJudgeProvider({ profiles: {} }, createDeps());

  await assert.rejects(
    async () =>
      provider.evaluate({
        output: 'Paris is the capital of France.',
        rubric: 'Pass if correct.',
        assertions: ['The answer addresses the request.'],
        dimension: 'correctness',
        judge: {
          profile: 'default',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Judge profile 'default' is not registered/);
      return true;
    },
  );
});

test('createAiSdkJudgeProvider: inherited profile names are rejected', async () => {
  const provider = createAiSdkJudgeProvider({ profiles: {} }, createDeps());

  await assert.rejects(
    async () =>
      provider.evaluate({
        output: 'Paris is the capital of France.',
        rubric: 'Pass if correct.',
        assertions: ['The answer addresses the request.'],
        dimension: 'correctness',
        judge: {
          profile: 'toString',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Judge profile 'toString' is not registered/);
      return true;
    },
  );
});

test('createAiSdkJudgeProvider: normalizes missing assertion results to failed assertions', async () => {
  const provider = createAiSdkJudgeProvider(
    {
      profiles: {
        default: createMockModel('gpt-4.1-mini'),
      },
    },
    createDeps({
      generateText: (async () => ({
        output: {
          summary: 'Only one assertion returned.',
          assertions: [
            {
              assertion: 'The answer addresses the request.',
              pass: true,
              reason: 'It does.',
            },
          ],
        },
      })) as unknown as AiSdkJudgeProviderDependencies['generateText'],
    }),
  );

  const result = await provider.evaluate({
    output: 'Paris is the capital of France.',
    rubric: 'Pass if correct.',
    assertions: ['The answer addresses the request.', 'The answer is grounded.'],
    dimension: 'correctness',
    judge: {
      profile: 'default',
    },
  });

  assert.equal(result.score, 0.5);
  assert.deepEqual(result.assertions, [
    {
      assertion: 'The answer addresses the request.',
      pass: true,
      reason: 'It does.',
    },
    {
      assertion: 'The answer is grounded.',
      pass: false,
      reason: 'Judge response did not include a result for this assertion.',
    },
  ]);
});

test('createAiSdkJudgeProvider: falls back to assertion order when texts do not match exactly', async () => {
  const provider = createAiSdkJudgeProvider(
    {
      profiles: {
        research: createMockModel('gpt-5.4'),
      },
    },
    createDeps({
      generateText: (async () => ({
        output: {
          summary: 'All assertions pass.',
          assertions: [
            {
              assertion: 'Assertion 1',
              pass: true,
              reason: 'Search and fetch occurred before writing.',
            },
            {
              assertion: 'Assertion 2',
              pass: true,
              reason: 'The sources are official.',
            },
          ],
        },
      })) as unknown as AiSdkJudgeProviderDependencies['generateText'],
    }),
  );

  const result = await provider.evaluate({
    output:
      'Created: TypeScript latest stable release brief\nSummary: TypeScript 5.9 is the latest stable release.',
    rubric: 'Pass if research is grounded.',
    assertions: [
      'The trace shows at least one public web search and at least one fetched source page used before the craft was written.',
      'The fetched sources used for the release facts are official or clearly authoritative for the requested TypeScript release information.',
    ],
    dimension: 'web research grounding',
    judge: {
      profile: 'research',
    },
  });

  assert.equal(result.score, 1);
  assert.deepEqual(result.assertions, [
    {
      assertion:
        'The trace shows at least one public web search and at least one fetched source page used before the craft was written.',
      pass: true,
      reason: 'Search and fetch occurred before writing.',
    },
    {
      assertion:
        'The fetched sources used for the release facts are official or clearly authoritative for the requested TypeScript release information.',
      pass: true,
      reason: 'The sources are official.',
    },
  ]);
});

test('createAiSdkJudgeProvider: prefers exact text matches before positional fallback', async () => {
  const provider = createAiSdkJudgeProvider(
    {
      profiles: {
        research: createMockModel('gpt-5.4'),
      },
    },
    createDeps({
      generateText: (async () => ({
        output: {
          summary: 'Mixed exact and fallback matches.',
          assertions: [
            {
              assertion:
                'The fetched sources used for the release facts are official or clearly authoritative for the requested TypeScript release information.',
              pass: true,
              reason: 'This exact assertion matched directly.',
            },
            {
              assertion: 'Assertion 1',
              pass: false,
              reason: 'The prerequisite trace evidence was incomplete.',
            },
          ],
        },
      })) as unknown as AiSdkJudgeProviderDependencies['generateText'],
    }),
  );

  const expectedAssertions = [
    'The trace shows at least one public web search and at least one fetched source page used before the craft was written.',
    'The fetched sources used for the release facts are official or clearly authoritative for the requested TypeScript release information.',
  ];

  const result = await provider.evaluate({
    output:
      'Created: TypeScript latest stable release brief\nSummary: TypeScript 5.9 is the latest stable release.',
    rubric: 'Pass if research is grounded.',
    assertions: expectedAssertions,
    dimension: 'web research grounding',
    judge: {
      profile: 'research',
    },
  });

  assert.deepEqual(result.assertions, [
    {
      assertion: expectedAssertions[0],
      pass: false,
      reason: 'The prerequisite trace evidence was incomplete.',
    },
    {
      assertion: expectedAssertions[1],
      pass: true,
      reason: 'This exact assertion matched directly.',
    },
  ]);
});
