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
  role: 'system' | 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallRecord[];
}

// 对应 Transcript/Trace
export interface ExecutionResult {
  schemaVersion: ExecutionResultSchemaVersion;
  output: string;
  structuredOutput?: unknown;
  trace?: {
    turns?: TurnRecord[];
    // 原始时间流，保证信息完整
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
  // 模型对真实环境的影响（不只看 Agent 的文本输出，还要看是否产生了实际环境变化）
  outcome?: Record<string, unknown>;
  error?: {
    // agent：被测者错误
    // system：youeval 框架错误
    type: 'agent' | 'system';
    message: string;
    code?: SystemErrorCode | string;
    retryable?: boolean;
  };
}
