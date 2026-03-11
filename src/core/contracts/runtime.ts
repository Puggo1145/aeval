import type { ExecutionResult, ExecutionResultInput } from './execution.js';
import type { RunSummaryData } from './run-summary.js';
import type { GraderResult } from './trial.js';

/**
 * Internal protocol: in-process execution context passed into one provider call.
 * This stays a plain object rather than a domain class.
 */
export type TaskContext = Readonly<{
  taskId: string;
  trialIndex: number;
  runName: string;
  runId: string;
  signal: AbortSignal;
}>;

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
  execute(ctx: TaskContext, run: Run): Promise<ExecutionResultInput>;
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

/**
 * Internal protocol: runtime event stream emitted by the orchestrator.
 * Events are plain discriminated-union objects, not domain classes.
 */
export type RunStartedEvent = Readonly<{
  readonly type: 'run:started';
  readonly runId: string;
  readonly taskId: string;
  readonly runName: string;
  readonly totalTrials: number;
}>;

export type TrialStartedEvent = Readonly<{
  readonly type: 'trial:started';
  readonly taskId: string;
  readonly runId: string;
  readonly runName: string;
  readonly trialIndex: number;
}>;

export type TrialCompletedEvent = Readonly<{
  readonly type: 'trial:completed';
  readonly taskId: string;
  readonly runId: string;
  readonly runName: string;
  readonly trialIndex: number;
  readonly pass: boolean;
  readonly durationMs: number;
}>;

export type TrialErrorEvent = Readonly<{
  readonly type: 'trial:error';
  readonly taskId: string;
  readonly runId: string;
  readonly runName: string;
  readonly trialIndex: number;
  readonly errorType: 'agent' | 'system';
  readonly message: string;
}>;

export type RunCompletedEvent = Readonly<{
  readonly type: 'run:completed';
  readonly summary: RunSummaryData;
}>;

export type RunEvent =
  | RunStartedEvent
  | TrialStartedEvent
  | TrialCompletedEvent
  | TrialErrorEvent
  | RunCompletedEvent;

export type TaskRunEvent = RunEvent;

// RunEvents 的工厂函数
export const RunEvents = {
  started(runId: string, taskId: string, runName: string, totalTrials: number): RunStartedEvent {
    return {
      type: 'run:started',
      runId,
      taskId,
      runName,
      totalTrials,
    };
  },

  trialStarted(
    taskId: string,
    runId: string,
    runName: string,
    trialIndex: number,
  ): TrialStartedEvent {
    return {
      type: 'trial:started',
      taskId,
      runId,
      runName,
      trialIndex,
    };
  },

  trialCompleted(
    taskId: string,
    runId: string,
    runName: string,
    trialIndex: number,
    pass: boolean,
    durationMs: number,
  ): TrialCompletedEvent {
    return {
      type: 'trial:completed',
      taskId,
      runId,
      runName,
      trialIndex,
      pass,
      durationMs,
    };
  },

  trialError(
    taskId: string,
    runId: string,
    runName: string,
    trialIndex: number,
    errorType: 'agent' | 'system',
    message: string,
  ): TrialErrorEvent {
    return {
      type: 'trial:error',
      taskId,
      runId,
      runName,
      trialIndex,
      errorType,
      message,
    };
  },

  completed(summary: RunSummaryData): RunCompletedEvent {
    return {
      type: 'run:completed',
      summary,
    };
  },
} as const;

export interface BaselineThresholds {
  passRateDrop?: number;
  passHatKDrop?: number;
  avgLatencyIncrease?: number;
}

export interface BaselineComparison {
  taskId: string;
  baselineRunId: string;
  currentRunId: string;
  passRateDelta: number;
  passHatKDelta?: number;
  avgLatencyDelta?: number;
  tokenBudgetBreached?: boolean;
  verdict: 'pass' | 'regressed' | 'improved';
}
