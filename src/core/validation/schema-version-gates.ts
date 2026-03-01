import type {
  ExecutionResultSchemaVersion,
  ExperimentSchemaVersion,
  RunManifestSchemaVersion,
  RunSummarySchemaVersion,
  TaskSchemaVersion,
  TrialResultSchemaVersion,
} from '../contracts/schema-versions.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import { ensureSchemaVersion } from './helpers.js';

export function assertTaskSchemaVersion(value: unknown): asserts value is TaskSchemaVersion {
  ensureSchemaVersion(value, SCHEMA_VERSIONS.TASK, 'task.schemaVersion');
}

export function assertExperimentSchemaVersion(
  value: unknown,
): asserts value is ExperimentSchemaVersion {
  ensureSchemaVersion(value, SCHEMA_VERSIONS.EXPERIMENT, 'experiment.schemaVersion');
}

export function assertExecutionResultSchemaVersion(
  value: unknown,
): asserts value is ExecutionResultSchemaVersion {
  ensureSchemaVersion(value, SCHEMA_VERSIONS.EXECUTION_RESULT, 'executionResult.schemaVersion');
}

export function assertTrialResultSchemaVersion(
  value: unknown,
): asserts value is TrialResultSchemaVersion {
  ensureSchemaVersion(value, SCHEMA_VERSIONS.TRIAL_RESULT, 'trialResult.schemaVersion');
}

export function assertRunManifestSchemaVersion(
  value: unknown,
): asserts value is RunManifestSchemaVersion {
  ensureSchemaVersion(value, SCHEMA_VERSIONS.RUN_MANIFEST, 'runManifest.schemaVersion');
}

export function assertRunSummarySchemaVersion(
  value: unknown,
): asserts value is RunSummarySchemaVersion {
  ensureSchemaVersion(value, SCHEMA_VERSIONS.RUN_SUMMARY, 'runSummary.schemaVersion');
}
