import type { ExecutionResult } from './execution.js';
import type { RunSummary } from './run-summary.js';
import type { GraderResult } from './trial.js';

/**
 * Provider 执行时收到的只读上下文
 */
export interface TaskContext {
  taskId: string;
  trialIndex: number;
  runName: string;
  runId: string;
  signal: AbortSignal;
}

// Provider 执行函数
export type TaskProvider = (
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>,
) => Promise<ExecutionResult>;

export interface ProviderRegistry {
  register(providerId: string, provider: TaskProvider): void;
  get(providerId: string): TaskProvider | undefined;
  has(providerId: string): boolean;
  list(): string[];
}

export interface RuntimeDefaults {
  maxConcurrency?: number;
}

// Grader 评分函数
export type Grader = (
  result: ExecutionResult,
  config: Record<string, unknown>,
) => Promise<GraderResult>;

export interface GraderRegistry {
  register(type: string, grader: Grader): void;
  get(type: string): Grader | undefined;
  has(type: string): boolean;
  list(): string[];
}

export type RunEvent =
  | { type: 'run:started'; runId: string; taskId: string; runName: string; totalTrials: number }
  | { type: 'trial:started'; taskId: string; runId: string; runName: string; trialIndex: number }
  | {
      type: 'trial:completed';
      taskId: string;
      runId: string;
      runName: string;
      trialIndex: number;
      pass: boolean;
      durationMs: number;
    }
  | {
      type: 'trial:error';
      taskId: string;
      runId: string;
      runName: string;
      trialIndex: number;
      errorType: 'agent' | 'system';
      message: string;
    }
  | { type: 'run:completed'; summary: RunSummary };

export interface BaselineThresholds {
  passRateDrop?: number;
  // pass^K drop
  // pass^k: k 次全部通过
  passHatKDrop?: number;
  avgLatencyIncrease?: number;
}

type TaskId = string;
export interface BaselineComparison {
  baselineRunId: string;
  currentRunId: string;
  passRateDelta: number;
  passHatKDelta?: number;
  avgLatencyDelta?: number;
  tokenBudgetBreached?: boolean;
  regressions: TaskId[]; // 相比 baseline 变差的 task id 列表
  improvements: TaskId[]; // 相比 baseline 变好的 task id 列表
  verdict: 'pass' | 'regressed' | 'improved';
}
