import type { ExecutionResult } from '../domain/execution-result.js';
import type { GraderLayer } from '../domain/grader-layer.js';
import type { Run } from '../domain/run.js';
import type { RunEvent } from '../domain/run-event.js';
import type { GraderResult } from './trial.js';

export interface TaskContext {
  taskId: string;
  trialIndex: number;
  runName: string;
  runId: string;
  signal: AbortSignal;
}

export interface Provider {
  readonly id: string;
  execute(ctx: TaskContext, run: Run): Promise<ExecutionResult>;
}

export interface Providers {
  register(provider: Provider): void;
  get(providerId: string): Provider | undefined;
  require(providerId: string): Provider;
  has(providerId: string): boolean;
  list(): string[];
}

export interface RuntimeDefaults {
  maxConcurrency?: number;
}

export interface GraderValidationResult {
  valid: boolean;
  reason?: string;
}

export interface Grader {
  readonly type: string;
  grade(result: ExecutionResult, layer: GraderLayer): Promise<GraderResult>;
  validate?(layer: GraderLayer): GraderValidationResult;
}

export interface Graders {
  register(grader: Grader): void;
  get(type: string): Grader | undefined;
  require(type: string): Grader;
  has(type: string): boolean;
  list(): string[];
}

export type TaskRunEvent = RunEvent;

export interface BaselineThresholds {
  passRateDrop?: number;
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
  regressions: TaskId[];
  improvements: TaskId[];
  verdict: 'pass' | 'regressed' | 'improved';
}
