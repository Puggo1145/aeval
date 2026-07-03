/**
 * Version tags for every contract schema, reserved for future compatibility
 * checks and migrations.
 */
export const SCHEMA_VERSIONS = {
  SUITE: 'suite.v1',
  TASK: 'task.v1',
  EXECUTION_RESULT: 'execution-result.v1',
  TRIAL_RESULT: 'trial-result.v1',
  RUN_MANIFEST: 'run-manifest.v1',
  RUN_SUMMARY: 'run-summary.v1',
} as const;

export type SuiteSchemaVersion = typeof SCHEMA_VERSIONS.SUITE;
export type TaskSchemaVersion = typeof SCHEMA_VERSIONS.TASK;
export type ExecutionResultSchemaVersion = typeof SCHEMA_VERSIONS.EXECUTION_RESULT;
export type TrialResultSchemaVersion = typeof SCHEMA_VERSIONS.TRIAL_RESULT;
export type RunManifestSchemaVersion = typeof SCHEMA_VERSIONS.RUN_MANIFEST;
export type RunSummarySchemaVersion = typeof SCHEMA_VERSIONS.RUN_SUMMARY;

export type AnySchemaVersion = (typeof SCHEMA_VERSIONS)[keyof typeof SCHEMA_VERSIONS];
