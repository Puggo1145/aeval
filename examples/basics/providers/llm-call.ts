import { type ExecutionResultInput, type Provider, type Run, type TaskContext } from '@aeval/core';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

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

function toSystemError(message: string): ExecutionResultInput {
  return {
    output: '',
    error: {
      type: 'system',
      message,
    },
  };
}

export class BasicLlmProvider implements Provider {
  readonly id = 'basic-llm';

  async execute(ctx: TaskContext, run: Run): Promise<ExecutionResultInput> {
    const params = run.params;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return toSystemError('Missing OPENAI_API_KEY environment variable.');
    }

    const model = getStringParam(params, 'model') ?? 'gpt-4o-mini';
    const systemPrompt = getStringParam(params, 'systemPrompt');
    const userPrompt = getStringParam(params, 'prompt');
    const temperature = getNumberParam(params, 'temperature') ?? 0;

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
}
