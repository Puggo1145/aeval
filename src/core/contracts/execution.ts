import type { ExecutionResultSchemaVersion } from './schema-versions.js';

export const SYSTEM_ERROR_CODES = {
  ABORTED: 'aborted',
  GRADER_EXCEPTION: 'grader_exception',
  PROVIDER_EXCEPTION: 'provider_exception',
  TIMEOUT: 'timeout',
} as const;

export type SystemErrorCode = (typeof SYSTEM_ERROR_CODES)[keyof typeof SYSTEM_ERROR_CODES];

export interface ToolCallRecord {
  tool: string;
  params?: Record<string, unknown>;
  result?: unknown;
  durationMs?: number;
}

export interface TurnRecord {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallRecord[];
}

export interface ExecutionResult {
  schemaVersion: ExecutionResultSchemaVersion;
  output: string;
  structuredOutput?: unknown;
  trace?: {
    turns?: TurnRecord[];
    rawEvents?: unknown[];
  };
  metrics?: {
    latencyMs?: number;
    timeToFirstTokenMs?: number;
    model?: string;
    tokenUsage?: {
      input?: number;
      output?: number;
      total?: number;
    };
    [key: string]: unknown;
  };
  outcome?: Record<string, unknown>;
  error?: {
    type: 'agent' | 'system';
    message: string;
    code?: SystemErrorCode | string;
    retryable?: boolean;
  };
}
