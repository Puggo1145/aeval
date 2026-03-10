import type { RunSummary } from './run-summary.js';

abstract class BaseRunEvent {
  abstract readonly type:
    | 'run:started'
    | 'trial:started'
    | 'trial:completed'
    | 'trial:error'
    | 'run:completed';
}

export class RunStartedEvent extends BaseRunEvent {
  readonly type = 'run:started';

  constructor(
    readonly runId: string,
    readonly taskId: string,
    readonly runName: string,
    readonly totalTrials: number,
  ) {
    super();
  }
}

export class TrialStartedEvent extends BaseRunEvent {
  readonly type = 'trial:started';

  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly runName: string,
    readonly trialIndex: number,
  ) {
    super();
  }
}

export class TrialCompletedEvent extends BaseRunEvent {
  readonly type = 'trial:completed';

  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly runName: string,
    readonly trialIndex: number,
    readonly pass: boolean,
    readonly durationMs: number,
  ) {
    super();
  }
}

export class TrialErrorEvent extends BaseRunEvent {
  readonly type = 'trial:error';

  constructor(
    readonly taskId: string,
    readonly runId: string,
    readonly runName: string,
    readonly trialIndex: number,
    readonly errorType: 'agent' | 'system',
    readonly message: string,
  ) {
    super();
  }
}

export class RunCompletedEvent extends BaseRunEvent {
  readonly type = 'run:completed';

  constructor(readonly summary: RunSummary) {
    super();
  }
}

export type RunEvent =
  | RunStartedEvent
  | TrialStartedEvent
  | TrialCompletedEvent
  | TrialErrorEvent
  | RunCompletedEvent;
