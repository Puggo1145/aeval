// 一次评测运行（run）的元数据记录

import type { RunManifestSchemaVersion } from './schema-versions.js';

export interface RunManifestTaskSourceRecord {
  adapter: string;
  ref: string;
  revision: string;
}

export interface RunManifest {
  schemaVersion: RunManifestSchemaVersion;
  runId: string;
  suiteId: string;
  suiteName: string;
  taskId: string;
  runName: string;
  taskSource: RunManifestTaskSourceRecord;
  taskHash: string;
  configHash: string;
  startedAt: string;
  gitSha?: string;
  completedAt?: string;
}
