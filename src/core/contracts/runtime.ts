import type { ExecutionResult } from '../domain/execution-result.js';
import type { ExecutionResultData } from './execution.js';
import type { RunSummaryData } from './run-summary.js';
import type { GraderResult } from './trial.js';

export interface TaskContext {
  taskId: string;
  trialIndex: number;
  runName: string;
  runId: string;
  signal: AbortSignal;
}

export interface Run {
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface GraderLayer {
  readonly name: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly weight?: number;
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
  grade(result: ExecutionResult | ExecutionResultData, layer: GraderLayer): Promise<GraderResult>;
  validate?(layer: GraderLayer): GraderValidationResult;
}

export interface Graders {
  register(grader: Grader): void;
  get(type: string): Grader | undefined;
  require(type: string): Grader;
  has(type: string): boolean;
  list(): string[];
}

export interface RunStartedEvent {
  readonly type: 'run:started';
  readonly runId: string;
  readonly taskId: string;
  readonly runName: string;
  readonly totalTrials: number;
}

export interface TrialStartedEvent {
  readonly type: 'trial:started';
  readonly taskId: string;
  readonly runId: string;
  readonly runName: string;
  readonly trialIndex: number;
}

export interface TrialCompletedEvent {
  readonly type: 'trial:completed';
  readonly taskId: string;
  readonly runId: string;
  readonly runName: string;
  readonly trialIndex: number;
  readonly pass: boolean;
  readonly durationMs: number;
}

export interface TrialErrorEvent {
  readonly type: 'trial:error';
  readonly taskId: string;
  readonly runId: string;
  readonly runName: string;
  readonly trialIndex: number;
  readonly errorType: 'agent' | 'system';
  readonly message: string;
}

export interface RunCompletedEvent {
  readonly type: 'run:completed';
  readonly summary: RunSummaryData;
}

export type RunEvent =
  | RunStartedEvent
  | TrialStartedEvent
  | TrialCompletedEvent
  | TrialErrorEvent
  | RunCompletedEvent;

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
