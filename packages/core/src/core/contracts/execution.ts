import { z } from 'zod';
import { throwFirstZodValidationError } from '../validation/helpers.js';
import { UnknownRecordSchema } from './schema-primitives.js';
import { type ExecutionResultSchemaVersion, SCHEMA_VERSIONS } from './schema-versions.js';

export const SYSTEM_ERROR_CODES = {
  ABORTED: 'aborted',
  GRADER_EXCEPTION: 'grader_exception',
  PROVIDER_EXCEPTION: 'provider_exception',
  TIMEOUT: 'timeout',
} as const;

export type SystemErrorCode = (typeof SYSTEM_ERROR_CODES)[keyof typeof SYSTEM_ERROR_CODES];

export interface ToolCallRecord {
  readonly tool: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly durationMs?: number;
}

export interface TurnRecord {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
  readonly toolCalls?: readonly ToolCallRecord[];
}

export interface ExecutionTrace {
  readonly turns?: readonly TurnRecord[];
  readonly rawEvents?: readonly unknown[];
}

export interface ExecutionMetrics {
  /**
   * Provider-reported latency for the model/tool execution itself.
   * This is distinct from core orchestration wall-clock duration.
   */
  readonly latencyMs?: number;
  readonly timeToFirstTokenMs?: number;
  readonly model?: string;
  readonly tokenUsage?: Readonly<{
    input?: number;
    output?: number;
    total?: number;
  }>;
  readonly [key: string]: unknown;
}

export interface ExecutionError {
  readonly type: 'agent' | 'system';
  readonly message: string;
  readonly code?: SystemErrorCode | string;
  readonly retryable?: boolean;
}

export interface ExecutionResultInput {
  output: string;
  structuredOutput?: unknown;
  trace?: ExecutionTrace;
  metrics?: ExecutionMetrics;
  outcome?: Record<string, unknown>;
  error?: ExecutionError;
}

export interface ExecutionResult {
  readonly output: string;
  readonly structuredOutput?: unknown;
  readonly trace?: ExecutionTrace;
  readonly metrics?: ExecutionMetrics;
  readonly outcome?: Readonly<Record<string, unknown>>;
  readonly error?: ExecutionError;
}

export interface ExecutionResultData extends ExecutionResultInput {
  schemaVersion: ExecutionResultSchemaVersion;
}

const ToolCallRecordSchema = z
  .object({
    tool: z.string().trim().min(1),
    params: UnknownRecordSchema.optional(),
    result: z.unknown().optional(),
    durationMs: z.number().finite().nonnegative().optional(),
  })
  .strict();

const TurnRecordSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string(),
    toolCalls: z.array(ToolCallRecordSchema).optional(),
  })
  .strict();

const ExecutionTraceSchema = z
  .object({
    turns: z.array(TurnRecordSchema).optional(),
    rawEvents: z.array(z.unknown()).optional(),
  })
  .strict();

const ExecutionMetricsSchema = z
  .object({
    latencyMs: z.number().finite().nonnegative().optional(),
    timeToFirstTokenMs: z.number().finite().nonnegative().optional(),
    model: z.string().optional(),
    tokenUsage: z
      .object({
        input: z.number().int().nonnegative().optional(),
        output: z.number().int().nonnegative().optional(),
        total: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .catchall(z.unknown());

const ExecutionErrorSchema = z
  .object({
    type: z.enum(['agent', 'system']),
    message: z.string(),
    code: z.string().optional(),
    retryable: z.boolean().optional(),
  })
  .strict();

const ExecutionResultInputSchema = z
  .object({
    output: z.string(),
    structuredOutput: z.unknown().optional(),
    trace: ExecutionTraceSchema.optional(),
    metrics: ExecutionMetricsSchema.optional(),
    outcome: UnknownRecordSchema.optional(),
    error: ExecutionErrorSchema.optional(),
  })
  .strict();

const ExecutionResultDataSchema = ExecutionResultInputSchema.extend({
  schemaVersion: z.literal(SCHEMA_VERSIONS.EXECUTION_RESULT),
}).strict();

export function parseExecutionResult(input: unknown): ExecutionResult {
  const parsed = ExecutionResultInputSchema.safeParse(input);
  if (!parsed.success) {
    throwFirstZodValidationError(parsed.error, 'executionResult');
  }

  return parsed.data;
}

export function parseExecutionResultData(input: unknown): ExecutionResultData {
  const parsed = ExecutionResultDataSchema.safeParse(input);
  if (!parsed.success) {
    throwFirstZodValidationError(parsed.error, 'executionResultRecord');
  }

  return parsed.data;
}

export function fromExecutionResultData(input: ExecutionResultData): ExecutionResult {
  const { schemaVersion: _schemaVersion, ...result } = parseExecutionResultData(input);
  return result;
}

export function toExecutionResultData(result: ExecutionResult): ExecutionResultData {
  return {
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
    output: result.output,
    ...(result.structuredOutput !== undefined ? { structuredOutput: result.structuredOutput } : {}),
    ...(result.trace !== undefined ? { trace: result.trace } : {}),
    ...(result.metrics !== undefined ? { metrics: result.metrics } : {}),
    ...(result.outcome !== undefined ? { outcome: { ...result.outcome } } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}
