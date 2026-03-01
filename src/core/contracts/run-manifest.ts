import type { RunManifestSchemaVersion } from './schema-versions.js';

export interface RunManifestTaskSourceRecord {
  adapter: string;
  ref: string;
  revision: string;
}

export interface RunManifest {
  schemaVersion: RunManifestSchemaVersion;
  runId: string;
  experimentName: string;
  taskSource: RunManifestTaskSourceRecord;
  datasetHash: string;
  configHash: string;
  startedAt: string;
  gitSha?: string;
  completedAt?: string;
}
