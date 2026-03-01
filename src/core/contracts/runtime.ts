import type { ExecutionResult } from './execution.js';
import type { RunSummary } from './run-summary.js';
import type { GraderResult } from './trial.js';

export interface TaskContext {
  taskId: string;
  trialIndex: number;
  runName: string;
  runId: string;
  overrides: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}

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
  | { type: 'run:started'; runId: string; runName: string; totalTasks: number }
  | { type: 'trial:started'; taskId: string; trialIndex: number }
  | {
      type: 'trial:completed';
      taskId: string;
      trialIndex: number;
      pass: boolean;
      durationMs: number;
    }
  | {
      type: 'trial:error';
      taskId: string;
      trialIndex: number;
      errorType: 'agent' | 'system';
      message: string;
    }
  | { type: 'run:completed'; summary: RunSummary };

export interface BaselineThresholds {
  passRateDrop?: number;
  passHatKDrop?: number;
  avgLatencyIncrease?: number;
}

export interface BaselineComparison {
  baselineRunId: string;
  currentRunId: string;
  passRateDelta: number;
  passHatKDelta?: number;
  avgLatencyDelta?: number;
  tokenBudgetBreached?: boolean;
  regressions: string[];
  improvements: string[];
  verdict: 'pass' | 'regressed' | 'improved';
}
