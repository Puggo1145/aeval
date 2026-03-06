import assert from 'node:assert/strict';
import test from 'node:test';
import type { LanguageModel } from 'ai';
import {
  createAiSdkJudgeProvider,
  type AiSdkJudgeProviderDependencies,
} from '../src/graders/llm/ai-sdk-judge-provider.js';

function createDeps(
  overrides: Partial<AiSdkJudgeProviderDependencies> = {},
): AiSdkJudgeProviderDependencies {
  return {
    generateObject: (async () => ({
      object: {
        summary: 'All assertions passed.',
        assertions: [
          {
            assertion: 'The answer addresses the request.',
            pass: true,
            reason: 'It does.',
          },
        ],
      },
    })) as AiSdkJudgeProviderDependencies['generateObject'],
    createAihubmixProvider: ((settings?: { apiKey?: string }) => {
      return ((modelId: string) => ({ provider: 'aihubmix', modelId, settings })) as unknown as LanguageModel;
    }) as AiSdkJudgeProviderDependencies['createAihubmixProvider'],
    ...overrides,
  };
}

test('createAiSdkJudgeProvider: selects aihubmix model branch', async () => {
  let capturedModel: unknown;
  const provider = createAiSdkJudgeProvider(
    {
      apiKey: 'test-aihubmix-key',
    },
    createDeps({
      generateObject: (async ({ model }) => {
        capturedModel = model;
        return {
          object: {
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
      }) as AiSdkJudgeProviderDependencies['generateObject'],
    }),
  );

  const result = await provider.evaluate({
    output: 'Paris is the capital of France.',
    rubric: 'Pass if correct.',
    assertions: ['The answer addresses the request.'],
    dimension: 'correctness',
    judge: {
      provider: 'aihubmix',
      model: 'gpt-4.1-mini',
    },
  });

  assert.deepEqual(capturedModel, {
    provider: 'aihubmix',
    modelId: 'gpt-4.1-mini',
    settings: {
      apiKey: 'test-aihubmix-key',
    },
  });
  assert.equal(result.provider, 'aihubmix');
  assert.equal(result.model, 'gpt-4.1-mini');
  assert.equal(result.score, 1);
});

test('createAiSdkJudgeProvider: supports custom systemPrompt and buildPrompt', async () => {
  let capturedSystem = '';
  let capturedPrompt = '';
  const provider = createAiSdkJudgeProvider(
    {
      apiKey: 'test-aihubmix-key',
    },
    {
      systemPrompt: (input) => `custom system for ${input.dimension}`,
      buildPrompt: (input) => `custom prompt for ${input.judge.model}: ${input.output}`,
    },
    createDeps({
      generateObject: (async ({ system, prompt }) => {
        capturedSystem = system as string;
        capturedPrompt = prompt as string;
        return {
          object: {
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
      }) as AiSdkJudgeProviderDependencies['generateObject'],
    }),
  );

  await provider.evaluate({
    output: 'Paris is the capital of France.',
    rubric: 'Pass if correct.',
    assertions: ['The answer addresses the request.'],
    dimension: 'correctness',
    judge: {
      provider: 'aihubmix',
      model: 'gpt-4.1-mini',
    },
  });

  assert.equal(capturedSystem, 'custom system for correctness');
  assert.equal(capturedPrompt, 'custom prompt for gpt-4.1-mini: Paris is the capital of France.');
});

test('createAiSdkJudgeProvider: missing provider config fails without leaking api key', async () => {
  const provider = createAiSdkJudgeProvider({}, createDeps());

  await assert.rejects(
    async () =>
      provider.evaluate({
        output: 'Paris is the capital of France.',
        rubric: 'Pass if correct.',
        assertions: ['The answer addresses the request.'],
        dimension: 'correctness',
        judge: {
          provider: 'aihubmix',
          model: 'gpt-4.1-mini',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /AIHubMix judge provider is not configured/);
      assert.doesNotMatch(error.message, /apiKey/i);
      assert.doesNotMatch(error.message, /test-aihubmix-key/);
      return true;
    },
  );
});

test('createAiSdkJudgeProvider: normalizes missing assertion results to failed assertions', async () => {
  const provider = createAiSdkJudgeProvider(
    {
      apiKey: 'test-aihubmix-key',
    },
    createDeps({
      generateObject: (async () => ({
        object: {
          summary: 'Only one assertion returned.',
          assertions: [
            {
              assertion: 'The answer addresses the request.',
              pass: true,
              reason: 'It does.',
            },
          ],
        },
      })) as AiSdkJudgeProviderDependencies['generateObject'],
    }),
  );

  const result = await provider.evaluate({
    output: 'Paris is the capital of France.',
    rubric: 'Pass if correct.',
    assertions: ['The answer addresses the request.', 'The answer is grounded.'],
    dimension: 'correctness',
    judge: {
      provider: 'aihubmix',
      model: 'gpt-4.1-mini',
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
      apiKey: 'test-aihubmix-key',
    },
    createDeps({
      generateObject: (async () => ({
        object: {
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
      })) as AiSdkJudgeProviderDependencies['generateObject'],
    }),
  );

  const result = await provider.evaluate({
    output: 'Created: TypeScript latest stable release brief\nSummary: TypeScript 5.9 is the latest stable release.',
    rubric: 'Pass if research is grounded.',
    assertions: [
      'The trace shows at least one public web search and at least one fetched source page used before the craft was written.',
      'The fetched sources used for the release facts are official or clearly authoritative for the requested TypeScript release information.',
    ],
    dimension: 'web research grounding',
    judge: {
      provider: 'aihubmix',
      model: 'gpt-5.4',
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
      apiKey: 'test-aihubmix-key',
    },
    createDeps({
      generateObject: (async () => ({
        object: {
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
      })) as AiSdkJudgeProviderDependencies['generateObject'],
    }),
  );

  const expectedAssertions = [
    'The trace shows at least one public web search and at least one fetched source page used before the craft was written.',
    'The fetched sources used for the release facts are official or clearly authoritative for the requested TypeScript release information.',
  ];

  const result = await provider.evaluate({
    output: 'Created: TypeScript latest stable release brief\nSummary: TypeScript 5.9 is the latest stable release.',
    rubric: 'Pass if research is grounded.',
    assertions: expectedAssertions,
    dimension: 'web research grounding',
    judge: {
      provider: 'aihubmix',
      model: 'gpt-5.4',
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
