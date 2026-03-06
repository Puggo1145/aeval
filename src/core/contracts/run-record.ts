import type { RunManifest } from './run-manifest.js';
import type { RunSummary } from './run-summary.js';

export type RunStatus = 'completed' | 'interrupted';

export interface RunRecord {
  runId: string;
  status: RunStatus;
  manifest: RunManifest | null;
  summary: RunSummary | null;
}
