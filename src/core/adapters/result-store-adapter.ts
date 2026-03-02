import type { RunManifest } from '../contracts/run-manifest.js';
import type { RunSummaryRecord } from '../contracts/run-summary.js';
import type { TrialResultRecord } from '../contracts/trial.js';

export interface BaselineRecord {
  runId: string;
  updatedAt: string;
}

export interface ResultStoreAdapter {
  saveRunManifest(input: RunManifest): Promise<void>;
  saveRunSummary(input: RunSummaryRecord): Promise<void>;
  saveTrial(input: TrialResultRecord): Promise<void>;
  getRunManifest(runId: string): Promise<RunManifest | null>;
  getRunSummary(runId: string): Promise<RunSummaryRecord | null>;
  listTrials(runId: string): Promise<TrialResultRecord[]>;
  saveBaseline(input: BaselineRecord): Promise<void>;
  getBaselineRunId(): Promise<string | null>;
  listRunIds(): Promise<string[]>;
}
