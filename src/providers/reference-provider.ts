import type { ExecutionResult } from '../core/contracts/execution.js';
import type { ProviderRegistry, TaskContext } from '../core/contracts/runtime.js';
import { SCHEMA_VERSIONS } from '../core/contracts/schema-versions.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function referenceProvider(
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>,
): Promise<ExecutionResult> {
  if (ctx.signal.aborted) {
    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output: '',
      error: {
        type: 'system',
        message: 'Aborted before execution.',
        code: 'aborted',
      },
    };
  }

  const output = typeof params.output === 'string' ? params.output : '';
  const structuredOutput = params.structuredOutput;
  const outcome =
    typeof params.outcome === 'object' && params.outcome !== null
      ? (params.outcome as Record<string, unknown>)
      : undefined;
  const latencyMs =
    typeof params.latencyMs === 'number' && params.latencyMs >= 0 ? params.latencyMs : 0;
  const model = typeof params.model === 'string' ? params.model : 'reference';

  const userMessage = `task=${ctx.taskId} trial=${ctx.trialIndex}`;
  const inputTokens = estimateTokens(userMessage);
  const outputTokens = estimateTokens(output);

  const result: ExecutionResult = {
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output,
    trace: {
      turns: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: output },
      ],
    },
    metrics: {
      latencyMs,
      model,
      tokenUsage: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
    },
  };

  if (structuredOutput !== undefined) {
    result.structuredOutput = structuredOutput;
  }

  if (outcome !== undefined) {
    result.outcome = outcome;
  }

  return result;
}

export function registerReferenceProvider(registry: ProviderRegistry): void {
  registry.register('reference', referenceProvider);
}
