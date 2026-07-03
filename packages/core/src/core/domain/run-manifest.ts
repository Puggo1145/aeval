import type { RunManifestRecord } from '../contracts/run-manifest.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import type { ExecutionPolicy } from '../runtime/task-execution.js';
import { computeSha256 } from '../utils/hash.js';
import type { Run } from './run.js';
import type { Suite } from './suite.js';
import type { Task } from './task.js';

export interface RunManifestCreateInput {
  runId: string;
  suite: Suite;
  task: Task;
  run: Run;
  execution: ExecutionPolicy;
}

export class RunManifest {
  readonly schemaVersion = SCHEMA_VERSIONS.RUN_MANIFEST;
  readonly runId: string;
  readonly suiteId: string;
  readonly suiteName: string;
  readonly taskId: string;
  readonly runName: string;
  readonly taskSource: RunManifestRecord['taskSource'];
  readonly taskHash: string;
  readonly configHash: string;
  readonly startedAt: string;
  readonly completedAt?: string;

  constructor(record: RunManifestRecord) {
    this.runId = record.runId;
    this.suiteId = record.suiteId;
    this.suiteName = record.suiteName;
    this.taskId = record.taskId;
    this.runName = record.runName;
    this.taskSource = Object.freeze({ ...record.taskSource });
    this.taskHash = record.taskHash;
    this.configHash = record.configHash;
    this.startedAt = record.startedAt;
    if (record.completedAt !== undefined) {
      this.completedAt = record.completedAt;
    }
  }

  static create(input: RunManifestCreateInput): RunManifest {
    const source = input.task.source;
    if (!source) {
      throw new Error(`Task '${input.task.id}' is missing source metadata.`);
    }

    return new RunManifest({
      schemaVersion: SCHEMA_VERSIONS.RUN_MANIFEST,
      runId: input.runId,
      suiteId: input.suite.id,
      suiteName: input.suite.name,
      taskId: input.task.id,
      runName: input.run.name,
      taskSource: {
        adapter: source.adapter,
        ref: source.ref,
        revision: source.revision,
      },
      taskHash: computeSha256(input.task.toDocument()),
      configHash: computeSha256({
        taskId: input.task.id,
        providerId: input.task.providerId,
        run: input.run.toDocument(),
        execution: input.execution,
      }),
      startedAt: new Date().toISOString(),
    });
  }

  complete(completedAt: string = new Date().toISOString()): RunManifest {
    return new RunManifest({
      ...this.toRecord(),
      completedAt,
    });
  }

  toRecord(): RunManifestRecord {
    return {
      schemaVersion: this.schemaVersion,
      runId: this.runId,
      suiteId: this.suiteId,
      suiteName: this.suiteName,
      taskId: this.taskId,
      runName: this.runName,
      taskSource: { ...this.taskSource },
      taskHash: this.taskHash,
      configHash: this.configHash,
      startedAt: this.startedAt,
      ...(this.completedAt !== undefined ? { completedAt: this.completedAt } : {}),
    };
  }
}
