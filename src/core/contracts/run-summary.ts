import type { RunSummarySchemaVersion } from './schema-versions.js';

export interface RunSummaryData {
  schemaVersion: RunSummarySchemaVersion;
  runId: string;
  taskId: string;
  runName: string;
  totalTrials: number;
  passRate: number;
  passAtK?: number;
  passHatK?: number;
  /**
   * Average of provider-reported `execution.metrics.latencyMs` across completed trials.
   * This intentionally does not use `trial.timings.durationMs`.
   */
  avgLatencyMs?: number;
}

export interface RunSummaryRecord {
  runId: string;
  summary: RunSummaryData;
}
