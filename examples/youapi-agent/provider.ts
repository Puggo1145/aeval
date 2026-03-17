import {
  type ExecutionResult,
  type ExecutionResultInput,
  type Provider,
  type Run,
  type TaskContext,
} from '@youmindinc/youeval-core';

type TurnRecord = NonNullable<NonNullable<ExecutionResult['trace']>['turns']>[number];
type ToolCallRecord = NonNullable<TurnRecord['toolCalls']>[number];
type WrittenCraft = {
  tool: string;
  id: string;
  title?: string;
  contentType?: string;
  plainContent?: string;
  rawContent?: string;
  contentPreview?: string;
  contentLength?: number;
  isNew?: boolean;
};

type YouapiEvalAgentResponse = {
  output?: unknown;
  structuredOutput?: unknown;
  structured_output?: unknown;
  trace?: unknown;
  metrics?: unknown;
  outcome?: unknown;
  error?: ExecutionResult['error'];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolCallRecord(value: unknown): ToolCallRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const tool = typeof value.tool === 'string' ? value.tool : undefined;
  if (!tool) {
    return undefined;
  }

  const params = isRecord(value.params) ? value.params : undefined;
  const durationMs =
    typeof value.durationMs === 'number'
      ? value.durationMs
      : typeof value.duration_ms === 'number'
        ? value.duration_ms
        : undefined;

  return {
    tool,
    ...(params ? { params } : {}),
    ...(value.result !== undefined ? { result: value.result } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function normalizeTurnRecord(value: unknown): TurnRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const role = value.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant') {
    return undefined;
  }

  const content = typeof value.content === 'string' ? value.content : '';
  const rawToolCalls = Array.isArray(value.toolCalls)
    ? value.toolCalls
    : Array.isArray(value.tool_calls)
      ? value.tool_calls
      : undefined;
  const toolCalls = rawToolCalls
    ?.map((toolCall) => normalizeToolCallRecord(toolCall))
    .filter((toolCall): toolCall is ToolCallRecord => toolCall !== undefined);

  return {
    role,
    content,
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function normalizeTrace(trace: unknown): ExecutionResult['trace'] | undefined {
  if (!isRecord(trace)) {
    return undefined;
  }

  const turns = Array.isArray(trace.turns)
    ? trace.turns
        .map((turn) => normalizeTurnRecord(turn))
        .filter((turn): turn is TurnRecord => turn !== undefined)
    : undefined;
  const rawEvents = Array.isArray(trace.rawEvents)
    ? trace.rawEvents
    : Array.isArray(trace.raw_events)
      ? trace.raw_events
      : undefined;

  if ((!turns || turns.length === 0) && (!rawEvents || rawEvents.length === 0)) {
    return undefined;
  }

  return {
    ...(turns && turns.length > 0 ? { turns } : {}),
    ...(rawEvents ? { rawEvents } : {}),
  };
}

function normalizeMetrics(metrics: unknown, roundTripMs: number): ExecutionResult['metrics'] {
  if (!isRecord(metrics)) {
    return { roundTripMs };
  }

  const latencyMs =
    typeof metrics.latencyMs === 'number'
      ? metrics.latencyMs
      : typeof metrics.latency_ms === 'number'
        ? metrics.latency_ms
        : undefined;
  const timeToFirstTokenMs =
    typeof metrics.timeToFirstTokenMs === 'number'
      ? metrics.timeToFirstTokenMs
      : typeof metrics.time_to_first_token_ms === 'number'
        ? metrics.time_to_first_token_ms
        : undefined;
  const model = typeof metrics.model === 'string' ? metrics.model : undefined;

  return {
    ...(latencyMs !== undefined ? { latencyMs } : {}),
    ...(timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs } : {}),
    ...(model ? { model } : {}),
    roundTripMs,
  };
}

function getStringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function getBooleanField(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return undefined;
}

function getNumberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function extractWrittenCraft(toolCall: ToolCallRecord): WrittenCraft | undefined {
  if (toolCall.tool !== 'write' && toolCall.tool !== 'proxy_write') {
    return undefined;
  }
  if (!isRecord(toolCall.result)) {
    return undefined;
  }

  const result = toolCall.result;
  const contentMeta = isRecord(result.content) ? result.content : undefined;
  const page = isRecord(result.page) ? result.page : undefined;
  const note = isRecord(result.note) ? result.note : undefined;
  const entity = page ?? note;
  const entityContent = entity && isRecord(entity.content) ? entity.content : undefined;
  const id =
    getStringField(contentMeta ?? {}, 'id') ?? (entity ? getStringField(entity, 'id') : undefined);
  const title =
    getStringField(contentMeta ?? {}, 'title') ??
    (entity ? getStringField(entity, 'title') : undefined);
  const contentType =
    getStringField(contentMeta ?? {}, 'contentType') ??
    getStringField(result, 'content_type') ??
    (entity ? getStringField(entity, 'type') : undefined);
  const plainContent = entityContent ? getStringField(entityContent, 'plain') : undefined;
  const rawContent = entityContent ? getStringField(entityContent, 'raw') : undefined;
  const contentPreview = getStringField(contentMeta ?? {}, 'contentPreview');
  const contentLength = getNumberField(contentMeta ?? {}, 'contentLength');
  const isNew = getBooleanField(contentMeta ?? {}, 'isNew') ?? getBooleanField(result, 'is_new');

  if (!id) {
    return undefined;
  }

  return {
    tool: toolCall.tool,
    id,
    ...(title !== undefined ? { title } : {}),
    ...(contentType !== undefined ? { contentType } : {}),
    ...(plainContent !== undefined ? { plainContent } : {}),
    ...(rawContent !== undefined ? { rawContent } : {}),
    ...(contentPreview !== undefined ? { contentPreview } : {}),
    ...(contentLength !== undefined ? { contentLength } : {}),
    ...(isNew !== undefined ? { isNew } : {}),
  };
}

function extractWrittenCrafts(trace: ExecutionResult['trace'] | undefined): WrittenCraft[] {
  if (!trace?.turns) {
    return [];
  }

  return trace.turns.flatMap((turn) =>
    (turn.toolCalls ?? [])
      .map((toolCall) => extractWrittenCraft(toolCall))
      .filter((craft): craft is WrittenCraft => craft !== undefined),
  );
}

function normalizeOutcome(
  outcome: unknown,
  trace: ExecutionResult['trace'] | undefined,
): ExecutionResult['outcome'] | undefined {
  const normalized: Record<string, unknown> = isRecord(outcome) ? { ...outcome } : {};

  if (normalized.chatId === undefined && normalized.chat_id !== undefined) {
    normalized.chatId = normalized.chat_id;
    delete normalized.chat_id;
  }

  const writtenCrafts = extractWrittenCrafts(trace);
  if (writtenCrafts.length > 0) {
    normalized.writtenCrafts = writtenCrafts;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function getStringParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toSystemError(message: string, code?: string): ExecutionResultInput {
  return {
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
): string | ExecutionResultInput {
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

export class YouapiAgentProvider implements Provider {
  readonly id = 'youapi-agent';

  async execute(ctx: TaskContext, run: Run): Promise<ExecutionResultInput> {
    const params = run.params;
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
      const structuredOutput =
        payload.structuredOutput !== undefined
          ? payload.structuredOutput
          : payload.structured_output;
      const trace = normalizeTrace(payload.trace);
      const metrics = normalizeMetrics(payload.metrics, Date.now() - startedAt);
      const outcome = normalizeOutcome(payload.outcome, trace);

      return {
        output,
        ...(structuredOutput !== undefined ? { structuredOutput } : {}),
        ...(trace ? { trace } : {}),
        metrics,
        ...(outcome ? { outcome } : {}),
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
}
