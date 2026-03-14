import type { RunManifestRecord } from './run-manifest.js';
import type { RunSummaryData } from './run-summary.js';

export type RunStatus = 'completed' | 'interrupted';

export interface RunRecord {
  runId: string;
  status: RunStatus;
  manifest: RunManifestRecord | null;
  summary: RunSummaryData | null;
}
