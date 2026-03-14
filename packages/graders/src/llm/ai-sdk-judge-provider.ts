import { generateText, Output } from 'ai';
import { z } from 'zod';
import type {
  JudgeAssertionResult,
  JudgeProfileMap,
  JudgeProvider,
  JudgeProviderInput,
  JudgeProviderResult,
} from './judge-provider.js';

const JudgeAssertionSchema = z
  .object({
    assertion: z.string(),
    pass: z.boolean(),
    reason: z.string(),
  })
  .strict();

const JudgeResponseSchema = z
  .object({
    summary: z.string(),
    assertions: z.array(JudgeAssertionSchema),
  })
  .strict();

export interface AiSdkJudgeProviderOptions {
  profiles: JudgeProfileMap;
}

export interface AiSdkJudgeProviderDependencies {
  generateText: typeof generateText;
}

export interface AiSdkJudgeProviderPromptOptions {
  systemPrompt?: string | ((input: JudgeProviderInput) => string);
  buildPrompt?: (input: JudgeProviderInput) => string;
}

const defaultDependencies: AiSdkJudgeProviderDependencies = {
  generateText,
};

function serializeContext(context: unknown): string {
  if (context === undefined) {
    return 'No extra context was provided.';
  }

  try {
    return JSON.stringify(context, null, 2);
  } catch {
    return String(context);
  }
}

function resolveModel(options: AiSdkJudgeProviderOptions, input: JudgeProviderInput) {
  if (Object.hasOwn(options.profiles, input.judge.profile)) {
    const model = options.profiles[input.judge.profile];
    if (model !== undefined) {
      return model;
    }
  }

  throw new Error(
    `Judge profile '${input.judge.profile}' is not registered. Register it on BuiltinLlmJudgeGrader({ profiles }).`,
  );
}

function resolveModelName(model: unknown): string | undefined {
  if (model === null || typeof model !== 'object') {
    return undefined;
  }

  const candidate = (model as Record<string, unknown>).modelId;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : undefined;
}

function buildJudgePrompt(input: JudgeProviderInput): string {
  return [
    `Dimension: ${input.dimension}`,
    '',
    'Rubric:',
    input.rubric,
    '',
    'Assertions:',
    ...input.assertions.map((assertion, index) => `${index + 1}. ${assertion}`),
    '',
    'Candidate output:',
    input.output,
    '',
    'Context:',
    serializeContext(input.context),
    '',
    'Return one binary judgment for each assertion. Do not omit or merge assertions.',
  ].join('\n');
}

function resolveSystemPrompt(
  input: JudgeProviderInput,
  options?: AiSdkJudgeProviderPromptOptions,
): string {
  const systemPrompt = options?.systemPrompt;

  if (typeof systemPrompt === 'function') {
    return systemPrompt(input);
  }

  if (typeof systemPrompt === 'string') {
    return systemPrompt;
  }

  return 'You are a strict evaluation judge. Evaluate each assertion independently against the candidate output and the provided context.';
}

function resolveUserPrompt(
  input: JudgeProviderInput,
  options?: AiSdkJudgeProviderPromptOptions,
): string {
  if (options?.buildPrompt) {
    return options.buildPrompt(input);
  }

  return buildJudgePrompt(input);
}

function normalizeAssertions(
  expectedAssertions: string[],
  actualAssertions: JudgeAssertionResult[],
): JudgeAssertionResult[] {
  const normalizeAssertionKey = (value: string): string => value.trim().replace(/\s+/g, ' ');
  const normalizedActual = actualAssertions.map((item) => ({
    ...item,
    normalizedAssertion: normalizeAssertionKey(item.assertion),
  }));
  const usedActualIndexes = new Set<number>();
  const resolvedAssertions = new Array<JudgeAssertionResult | undefined>(expectedAssertions.length);

  expectedAssertions.forEach((assertion, expectedIndex) => {
    const normalizedExpected = normalizeAssertionKey(assertion);
    const exactMatchIndex = normalizedActual.findIndex(
      (item, actualIndex) =>
        !usedActualIndexes.has(actualIndex) && item.normalizedAssertion === normalizedExpected,
    );

    if (exactMatchIndex >= 0) {
      usedActualIndexes.add(exactMatchIndex);
      const actual = normalizedActual[exactMatchIndex];
      resolvedAssertions[expectedIndex] = {
        assertion,
        pass: actual.pass,
        reason: actual.reason,
      };
    }
  });

  return expectedAssertions.map((assertion, expectedIndex) => {
    const exactMatch = resolvedAssertions[expectedIndex];
    if (exactMatch) {
      return exactMatch;
    }

    const fallbackIndex = normalizedActual.findIndex(
      (_, actualIndex) => !usedActualIndexes.has(actualIndex),
    );
    if (fallbackIndex >= 0) {
      usedActualIndexes.add(fallbackIndex);
      const positional = normalizedActual[fallbackIndex];
      return {
        assertion,
        pass: positional.pass,
        reason: positional.reason,
      };
    }

    return {
      assertion,
      pass: false,
      reason: 'Judge response did not include a result for this assertion.',
    };
  });
}

export function createAiSdkJudgeProvider(
  options: AiSdkJudgeProviderOptions,
  promptOptionsOrDeps: AiSdkJudgeProviderPromptOptions | AiSdkJudgeProviderDependencies = {},
  maybeDeps?: AiSdkJudgeProviderDependencies,
): JudgeProvider {
  const promptOptions =
    maybeDeps === undefined && 'generateText' in promptOptionsOrDeps
      ? {}
      : (promptOptionsOrDeps as AiSdkJudgeProviderPromptOptions);
  const deps =
    maybeDeps ??
    ('generateText' in promptOptionsOrDeps
      ? (promptOptionsOrDeps as AiSdkJudgeProviderDependencies)
      : defaultDependencies);

  return {
    async evaluate(input): Promise<JudgeProviderResult> {
      const model = resolveModel(options, input);
      const response = await deps.generateText({
        model,
        output: Output.object({
          schema: JudgeResponseSchema,
          name: 'llm_judge_result',
          description: 'Binary assertion results and a summary for an evaluation judge.',
        }),
        system: resolveSystemPrompt(input, promptOptions),
        prompt: resolveUserPrompt(input, promptOptions),
      });

      const assertions = normalizeAssertions(input.assertions, response.output.assertions);
      const passedAssertions = assertions.filter((item) => item.pass).length;
      const score = assertions.length === 0 ? 0 : passedAssertions / assertions.length;

      return {
        pass: score === 1,
        score,
        reason: response.output.summary,
        assertions,
        profile: input.judge.profile,
        model: resolveModelName(model),
      };
    },
  };
}
