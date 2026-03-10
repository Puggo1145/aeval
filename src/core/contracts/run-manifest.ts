import type { RunManifestSchemaVersion } from './schema-versions.js';

export interface RunManifestSourceRecord {
  adapter: string;
  ref: string;
  revision: string;
}

export interface RunManifestRecord {
  schemaVersion: RunManifestSchemaVersion;
  runId: string;
  suiteId: string;
  suiteName: string;
  taskId: string;
  runName: string;
  taskSource: RunManifestSourceRecord;
  taskHash: string;
  configHash: string;
  startedAt: string;
  gitSha?: string;
  completedAt?: string;
}
