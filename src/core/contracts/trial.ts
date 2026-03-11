import type { ExecutionResultData } from './execution.js';
import type { TrialResultSchemaVersion } from './schema-versions.js';

export interface GraderResult {
  pass: boolean;
  score?: number;
  reason: string;
  meta?: Record<string, unknown>;
}

export interface TrialGraderResultRecord {
  name: string;
  type: string;
  result: GraderResult;
  weight?: number;
}

export interface TrialRecord {
  schemaVersion: TrialResultSchemaVersion;
  taskId: string;
  runId: string;
  runName: string;
  trialIndex: number;
  execution: ExecutionResultData;
  graderResults: TrialGraderResultRecord[];
  aggregate: {
    pass: boolean;
    score?: number;
  };
  timings: {
    startedAt: string;
    endedAt: string;
    /**
     * Core-measured wall-clock duration for the full trial lifecycle,
     * including provider execution, grading, retries, and orchestration overhead.
     */
    durationMs: number;
  };
}

export interface TrialResultRecord {
  runId: string;
  trial: TrialRecord;
}
