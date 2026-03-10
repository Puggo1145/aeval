import type { RunSummaryData } from '../contracts/run-summary.js';
import type {
  RunCompletedEvent as RunCompletedEventContract,
  RunStartedEvent as RunStartedEventContract,
  TrialCompletedEvent as TrialCompletedEventContract,
  TrialErrorEvent as TrialErrorEventContract,
  TrialStartedEvent as TrialStartedEventContract,
} from '../contracts/runtime.js';

abstract class BaseRunEvent {
  abstract readonly type:
    | 'run:started'
    | 'trial:started'
    | 'trial:completed'
    | 'trial:error'
    | 'run:completed';
}

export class RunStartedEvent extends BaseRunEvent implements RunStartedEventContract {
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

export class TrialStartedEvent extends BaseRunEvent implements TrialStartedEventContract {
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

export class TrialCompletedEvent extends BaseRunEvent implements TrialCompletedEventContract {
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

export class TrialErrorEvent extends BaseRunEvent implements TrialErrorEventContract {
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

export class RunCompletedEvent extends BaseRunEvent implements RunCompletedEventContract {
  readonly type = 'run:completed';

  constructor(readonly summary: RunSummaryData) {
    super();
  }
}
