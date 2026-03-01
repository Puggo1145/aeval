import type { RunSummarySchemaVersion } from './schema-versions.js';

export interface RunSummary {
  schemaVersion: RunSummarySchemaVersion;
  runId: string;
  runName: string;
  totalTasks: number;
  totalTrials: number;
  passRate: number;
  passAtK?: number;
  passHatK?: number;
  avgLatencyMs?: number;
}

export interface RunSummaryRecord {
  runId: string;
  summary: RunSummary;
}
