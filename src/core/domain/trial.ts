import {
  type ExecutionResult,
  fromExecutionResultData,
  toExecutionResultData,
} from '../contracts/execution.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import type {
  TrialGraderResultRecord,
  TrialRecord,
  TrialResultRecord,
} from '../contracts/trial.js';
import { cloneAndFreeze } from '../utils/immutability.js';

export interface TrialInit {
  taskId: string;
  runId: string;
  runName: string;
  trialIndex: number;
  execution: ExecutionResult;
  graderResults: TrialGraderResultRecord[];
  aggregate: {
    pass: boolean;
    score?: number;
  };
  timings: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
  };
}

export class Trial {
  readonly schemaVersion = SCHEMA_VERSIONS.TRIAL_RESULT;
  readonly taskId: string;
  readonly runId: string;
  readonly runName: string;
  readonly trialIndex: number;
  readonly execution: ExecutionResult;
  readonly graderResults: readonly TrialGraderResultRecord[];
  readonly aggregate: Readonly<TrialInit['aggregate']>;
  readonly timings: Readonly<TrialInit['timings']>;

  constructor(input: TrialInit) {
    this.taskId = input.taskId;
    this.runId = input.runId;
    this.runName = input.runName;
    this.trialIndex = input.trialIndex;
    this.execution = cloneAndFreeze(input.execution);
    this.graderResults = cloneAndFreeze(input.graderResults);
    this.aggregate = cloneAndFreeze(input.aggregate);
    this.timings = cloneAndFreeze(input.timings);
  }

  get trial(): TrialRecord {
    return this.toRecord();
  }

  get record(): TrialResultRecord {
    return {
      runId: this.runId,
      trial: this.toRecord(),
    };
  }

  static fromRecord(record: TrialRecord): Trial {
    return new Trial({
      taskId: record.taskId,
      runId: record.runId,
      runName: record.runName,
      trialIndex: record.trialIndex,
      execution: fromExecutionResultData(record.execution),
      graderResults: record.graderResults,
      aggregate: record.aggregate,
      timings: record.timings,
    });
  }

  toRecord(): TrialRecord {
    return {
      schemaVersion: this.schemaVersion,
      taskId: this.taskId,
      runId: this.runId,
      runName: this.runName,
      trialIndex: this.trialIndex,
      execution: toExecutionResultData(this.execution),
      graderResults: [...this.graderResults],
      aggregate: { ...this.aggregate },
      timings: { ...this.timings },
    };
  }
}
