import type { RunManifest } from '../domain/run-manifest.js';
import type { RunSummary } from '../domain/run-summary.js';

export type RunStatus = 'completed' | 'interrupted';

export interface RunRecord {
  runId: string;
  status: RunStatus;
  manifest: RunManifest | null;
  summary: RunSummary | null;
}
