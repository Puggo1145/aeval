import type { RunManifestRecord } from './run-manifest.js';
import type { RunSummaryData } from './run-summary.js';

export interface RunRecord {
  runId: string;
  manifest: RunManifestRecord | null;
  summary: RunSummaryData | null;
}
