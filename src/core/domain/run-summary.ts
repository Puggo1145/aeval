import type { RunSummaryData } from '../contracts/run-summary.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import type { Trial } from './trial.js';

export class RunSummary {
  readonly schemaVersion = SCHEMA_VERSIONS.RUN_SUMMARY;
  readonly runId: string;
  readonly taskId: string;
  readonly runName: string;
  readonly totalTrials: number;
  readonly passRate: number;
  readonly passAtK?: number;
  readonly passHatK?: number;
  readonly avgLatencyMs?: number;

  constructor(data: RunSummaryData) {
    this.runId = data.runId;
    this.taskId = data.taskId;
    this.runName = data.runName;
    this.totalTrials = data.totalTrials;
    this.passRate = data.passRate;
    if (data.passAtK !== undefined) {
      this.passAtK = data.passAtK;
    }
    if (data.passHatK !== undefined) {
      this.passHatK = data.passHatK;
    }
    if (data.avgLatencyMs !== undefined) {
      this.avgLatencyMs = data.avgLatencyMs;
    }
  }

  static fromTrials(runId: string, taskId: string, runName: string, trials: Trial[]): RunSummary {
    const totalTrials = trials.length;
    const passedTrials = trials.filter((trial) => trial.aggregate.pass).length;
    const anyPass = trials.some((trial) => trial.aggregate.pass);
    const allPass = trials.every((trial) => trial.aggregate.pass);
    const latencyValues = trials
      .map((trial) => trial.execution.metrics?.latencyMs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const passRate = totalTrials > 0 ? passedTrials / totalTrials : 0;
    const passAtK = totalTrials > 1 ? (anyPass ? 1 : 0) : undefined;
    const passHatK = totalTrials > 1 ? (allPass ? 1 : 0) : undefined;
    const avgLatencyMs =
      latencyValues.length > 0
        ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
        : undefined;

    return new RunSummary({
      schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
      runId,
      taskId,
      runName,
      totalTrials,
      passRate,
      ...(passAtK !== undefined ? { passAtK } : {}),
      ...(passHatK !== undefined ? { passHatK } : {}),
      ...(avgLatencyMs !== undefined ? { avgLatencyMs } : {}),
    });
  }

  static fromRecord(data: RunSummaryData): RunSummary {
    return new RunSummary(data);
  }

  toRecord(): RunSummaryData {
    return {
      schemaVersion: this.schemaVersion,
      runId: this.runId,
      taskId: this.taskId,
      runName: this.runName,
      totalTrials: this.totalTrials,
      passRate: this.passRate,
      ...(this.passAtK !== undefined ? { passAtK: this.passAtK } : {}),
      ...(this.passHatK !== undefined ? { passHatK: this.passHatK } : {}),
      ...(this.avgLatencyMs !== undefined ? { avgLatencyMs: this.avgLatencyMs } : {}),
    };
  }
}
