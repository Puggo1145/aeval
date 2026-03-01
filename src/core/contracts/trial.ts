import type { ExecutionResult } from './execution.js';
import type { TrialResultSchemaVersion } from './schema-versions.js';

export interface GraderResult {
  pass: boolean;
  score?: number;
  reason: string;
  meta?: Record<string, unknown>;
}

export interface TrialGraderResult {
  name: string;
  type: string;
  result: GraderResult;
  weight: number;
}

export interface TrialResult {
  schemaVersion: TrialResultSchemaVersion;
  taskId: string;
  runId: string;
  runName: string;
  trialIndex: number;
  execution: ExecutionResult;
  graderResults: TrialGraderResult[];
  aggregate: {
    pass: boolean;
    score?: number;
  };
  timings: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
  };
}

export interface TrialResultRecord {
  runId: string;
  trial: TrialResult;
}
