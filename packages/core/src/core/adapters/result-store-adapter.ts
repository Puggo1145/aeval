import type { RunManifestRecord } from '../contracts/run-manifest.js';
import type { RunSummaryRecord } from '../contracts/run-summary.js';
import type { TrialResultRecord } from '../contracts/trial.js';

export interface ClearedResultEntry {
  path: string;
  kind: 'file' | 'dir';
}

export interface Stores {
  saveRunManifest(input: RunManifestRecord): Promise<void>;
  saveRunSummary(input: RunSummaryRecord): Promise<void>;
  saveTrial(input: TrialResultRecord): Promise<void>;
  getRunManifest(runId: string): Promise<RunManifestRecord | null>;
  getRunSummary(runId: string): Promise<RunSummaryRecord | null>;
  listTrials(runId: string): Promise<TrialResultRecord[]>;
  listRunIds(): Promise<string[]>;
  clearResultsByRunIds(runIds: string[]): Promise<ClearedResultEntry[]>;
  clearAllResults(): Promise<ClearedResultEntry[]>;
}
