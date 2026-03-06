import { type ExecutionResult, SCHEMA_VERSIONS, type TaskContext } from 'youeval';

type YouapiEvalAgentResponse = {
  output?: unknown;
  structuredOutput?: unknown;
  trace?: ExecutionResult['trace'];
  metrics?: ExecutionResult['metrics'];
  outcome?: Record<string, unknown>;
  error?: ExecutionResult['error'];
};

function getStringParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toSystemError(message: string, code?: string): ExecutionResult {
  return {
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: '',
    error: {
      type: 'system',
      message,
      ...(code ? { code } : {}),
    },
  };
}

function getRequiredParam(
  params: Readonly<Record<string, unknown>>,
  key: 'userId' | 'spaceId' | 'boardId' | 'prompt',
): string | ExecutionResult {
  const value = getStringParam(params, key);
  if (value) {
    return value;
  }

  return toSystemError(`Provider param '${key}' must be a non-empty string.`);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export async function youapiAgentProvider(
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>,
): Promise<ExecutionResult> {
  const baseUrl = process.env.YOUAPI_BASE_URL;
  if (!baseUrl) {
    return toSystemError('Missing YOUAPI_BASE_URL environment variable.');
  }

  const evalApiSecret = process.env.EVAL_API_SECRET;
  if (!evalApiSecret) {
    return toSystemError('Missing EVAL_API_SECRET environment variable.');
  }

  const userId = getRequiredParam(params, 'userId');
  if (typeof userId !== 'string') return userId;

  const spaceId = getRequiredParam(params, 'spaceId');
  if (typeof spaceId !== 'string') return spaceId;

  const boardId = getRequiredParam(params, 'boardId');
  if (typeof boardId !== 'string') return boardId;

  const prompt = getRequiredParam(params, 'prompt');
  if (typeof prompt !== 'string') return prompt;

  const messageMode = getStringParam(params, 'messageMode');
  const chatModel = getStringParam(params, 'chatModel');
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/eval/agent/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': evalApiSecret,
      },
      body: JSON.stringify({
        userId,
        spaceId,
        boardId,
        prompt,
        ...(messageMode ? { messageMode } : {}),
        ...(chatModel ? { chatModel } : {}),
      }),
      signal: ctx.signal,
    });

    if (!response.ok) {
      const errorBody = (await safeReadText(response)).trim();
      return toSystemError(
        `youapi eval request failed with status ${response.status}${
          errorBody ? `: ${errorBody}` : ''
        }`,
      );
    }

    const payload = (await response.json()) as YouapiEvalAgentResponse;
    const output = typeof payload.output === 'string' ? payload.output : '';

    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
      output,
      ...(payload.structuredOutput !== undefined
        ? { structuredOutput: payload.structuredOutput }
        : {}),
      ...(payload.trace ? { trace: payload.trace } : {}),
      metrics: {
        ...(payload.metrics ?? {}),
        roundTripMs: Date.now() - startedAt,
      },
      ...(payload.outcome ? { outcome: payload.outcome } : {}),
      ...(payload.error ? { error: payload.error } : {}),
    };
  } catch (error) {
    if (ctx.signal.aborted) {
      return toSystemError('youapi eval request aborted by timeout/cancellation.', 'aborted');
    }

    const message = error instanceof Error ? error.message : 'Unknown request error.';
    return toSystemError(`youapi eval request failed: ${message}`);
  }
}
