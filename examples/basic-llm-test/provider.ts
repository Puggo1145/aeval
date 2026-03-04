import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { type ExecutionResult, SCHEMA_VERSIONS, type TaskContext } from 'youeval';

function getStringParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getNumberParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getStringParamFromSources(
  overrides: Readonly<Record<string, unknown>>,
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return getStringParam(overrides, key) ?? getStringParam(params, key);
}

function getNumberParamFromSources(
  overrides: Readonly<Record<string, unknown>>,
  params: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  return getNumberParam(overrides, key) ?? getNumberParam(params, key);
}

function toSystemError(message: string): ExecutionResult {
  return {
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: '',
    error: {
      type: 'system',
      message,
    },
  };
}

export async function basicLlmProvider(
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>,
): Promise<ExecutionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return toSystemError('Missing OPENAI_API_KEY environment variable.');
  }

  const model = getStringParamFromSources(ctx.overrides, params, 'model') ?? 'gpt-4o-mini';
  const systemPrompt = getStringParamFromSources(ctx.overrides, params, 'systemPrompt');
  const userPrompt = getStringParamFromSources(ctx.overrides, params, 'prompt');
  const temperature = getNumberParamFromSources(ctx.overrides, params, 'temperature') ?? 0;

  if (!userPrompt) {
    return toSystemError("Provider param 'prompt' must be a non-empty string.");
  }

  const startedAt = Date.now();

  const openai = createOpenAI({
    apiKey,
  });

  try {
    const response = await generateText({
      model: openai(model),
      system: systemPrompt,
      prompt: userPrompt,
      temperature,
      abortSignal: ctx.signal,
    });
    const output = response.text.trim();

    const latencyMs = Date.now() - startedAt;

    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output,
      trace: {
        turns: [
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: output },
        ],
      },
      metrics: {
        latencyMs,
        model,
        tokenUsage: {
          input: response.usage?.inputTokens,
          output: response.usage?.outputTokens,
          total: response.usage?.totalTokens,
        },
      },
    };
  } catch (error) {
    if (ctx.signal.aborted) {
      return toSystemError('LLM request aborted by timeout/cancellation.');
    }

    const message = error instanceof Error ? error.message : 'Unknown LLM request error.';
    return toSystemError(`LLM request failed: ${message}`);
  }
}
