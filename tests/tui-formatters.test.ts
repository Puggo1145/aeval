import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatInterruptedRunNote,
  formatRunSummaryDetails,
  formatRunOptionHint,
  formatRunOptionLabel,
  formatRunOptionStatsHint,
  formatRunsTable,
  formatTrialGraderDetails,
  formatTrialsTable,
} from '../src/interfaces/tui/formatters.js';

test('formatTrialsTable includes header row and aligned trial values', () => {
  const output = formatTrialsTable([
    {
      runId: 'run-1',
      trial: {
        schemaVersion: 'trial-result.v1',
        taskId: 'file-edit-agent/smoke/create-hello-001',
        runId: 'run-1',
        runName: 'try-5-mini',
        trialIndex: 0,
        execution: {
          schemaVersion: 'execution-result.v1',
          output: 'ok',
        },
        graderResults: [],
        aggregate: { pass: true },
        timings: {
          startedAt: '2026-03-04T00:00:00.000Z',
          endedAt: '2026-03-04T00:00:01.000Z',
          durationMs: 8571,
        },
      },
    },
  ]);

  assert.match(output, /^Task ID\s+Trial\s+Status\s+Score\s+Duration/m);
  assert.match(output, /file-edit-agent\/smoke\/create-hell\.\.\./);
  assert.match(output, /\bPASS\b/);
  assert.match(output, /8571ms/);
});

test('formatRunsTable includes suite and task columns', () => {
  const output = formatRunsTable(
    [
      {
        runId: 'run-1',
        status: 'completed',
        manifest: null,
        summary: {
          schemaVersion: 'run-summary.v1',
          runId: 'run-1',
          taskId: 'file-edit-agent/task-001',
          runName: 'try-5-mini',
          totalTrials: 2,
          passRate: 1,
        },
      },
    ],
    new Map([
      [
        'run-1',
        {
          suiteName: 'file-edit-agent',
          taskId: 'file-edit-agent/task-001',
        },
      ],
    ]),
  );

  assert.match(output, /^Run ID\s+Status\s+Suite\s+Task\s+Run Name\s+Pass Rate\s+Trials/m);
  assert.match(output, /file-edit-agent/);
  assert.match(output, /COMPLETED/);
});

test('formatRunsTable truncates long identifiers to keep columns stable', () => {
  const output = formatRunsTable(
    [
      {
        runId: 'run-1234567890-abcdefghijklmnopqrstuvwxyz',
        status: 'completed',
        manifest: null,
        summary: {
          schemaVersion: 'run-summary.v1',
          runId: 'run-1234567890-abcdefghijklmnopqrstuvwxyz',
          taskId: 'very/long/task/id/that/should/not/blow/up/the/table/layout',
          runName: 'very-long-run-name-for-display',
          totalTrials: 2,
          passRate: 1,
        },
      },
    ],
    new Map([
      [
        'run-1234567890-abcdefghijklmnopqrstuvwxyz',
        {
          suiteName: 'suite-with-a-very-long-name',
          taskId: 'very/long/task/id/that/should/not/blow_up/the_table_layout',
        },
      ],
    ]),
  );

  assert.match(output, /run-1234567890-ab\.\.\./);
  assert.match(output, /suite-with-a-ve\.\.\./);
});

test('formatRunOptionHint falls back to unknown suite and task when missing', () => {
  assert.equal(
    formatRunOptionHint(
      {
        runId: 'run-1',
        status: 'completed',
        manifest: null,
        summary: {
          schemaVersion: 'run-summary.v1',
          runId: 'run-1',
          taskId: 'task-001',
          runName: 'try-5-mini',
          totalTrials: 2,
          passRate: 1,
        },
      },
      undefined,
    ),
    'suite: unknown | task: unknown | runId: run-1',
  );
});

test('formatRunOptionLabel includes timestamp and shortened run id when manifest is present', () => {
  assert.equal(
    formatRunOptionLabel({
      runId: '7a215d3d-f536-4c23-92a3-fbab4076d3b3',
      status: 'completed',
      manifest: {
        schemaVersion: 'run-manifest.v1',
        runId: '7a215d3d-f536-4c23-92a3-fbab4076d3b3',
        suiteId: 'suite-a',
        suiteName: 'Suite A',
        taskId: 'task-001',
        runName: 'try-5-mini',
        taskSource: {
          adapter: 'local',
          ref: 'datasets/task-001.yaml',
          revision: 'sha256-task-001',
        },
        taskHash: 'task-hash-001',
        configHash: 'config-hash-001',
        startedAt: '2026-03-06T08:30:45.000Z',
        completedAt: '2026-03-06T08:31:10.000Z',
      },
      summary: {
        schemaVersion: 'run-summary.v1',
        runId: '7a215d3d-f536-4c23-92a3-fbab4076d3b3',
        taskId: 'task-001',
        runName: 'try-5-mini',
        totalTrials: 2,
        passRate: 1,
      },
    }),
    'try-5-mini | 2026-03-06 08:31Z | 7a215d3d',
  );
});

test('formatRunOptionLabel falls back to shortened run id when manifest timestamp is missing', () => {
  assert.equal(
    formatRunOptionLabel({
      runId: 'run-1234567890',
      status: 'completed',
      manifest: null,
      summary: {
        schemaVersion: 'run-summary.v1',
        runId: 'run-1234567890',
        taskId: 'task-001',
        runName: 'try-5-mini',
        totalTrials: 2,
        passRate: 1,
      },
    }),
    'try-5-mini | run-1234',
  );
});

test('formatRunOptionStatsHint includes pass rate, task id, and trial count', () => {
  assert.equal(
    formatRunOptionStatsHint({
      runId: 'run-1',
      status: 'completed',
      manifest: null,
      summary: {
        schemaVersion: 'run-summary.v1',
        runId: 'run-1',
        taskId: 'task-001',
        runName: 'try-5-mini',
        totalTrials: 3,
        passRate: 0.5,
      },
    }),
    'status=completed | pass=50.0% | task=task-001 | trials=3',
  );
});

test('formatRunOptionStatsHint shows interrupted status for incomplete runs', () => {
  assert.equal(
    formatRunOptionStatsHint({
      runId: 'run-2',
      status: 'interrupted',
      manifest: {
        schemaVersion: 'run-manifest.v1',
        runId: 'run-2',
        suiteId: 'suite-a',
        suiteName: 'Suite A',
        taskId: 'task-002',
        runName: 'nano',
        taskSource: {
          adapter: 'local',
          ref: 'datasets/task-002.yaml',
          revision: 'sha256-task-002',
        },
        taskHash: 'task-hash-002',
        configHash: 'config-hash-002',
        startedAt: '2026-03-06T00:00:00.000Z',
      },
      summary: null,
    }),
    'status=interrupted | task=task-002',
  );
});

test('formatTrialGraderDetails shows per-grader pass and reason', () => {
  const output = formatTrialGraderDetails({
    schemaVersion: 'trial-result.v1',
    taskId: 'file-edit-agent/smoke/modify-greeting-002',
    runId: 'run-1',
    runName: 'try-5-mini',
    trialIndex: 1,
    execution: {
      schemaVersion: 'execution-result.v1',
      output: 'ok',
      metrics: {
        latencyMs: 3455,
        tokenUsage: {
          input: 10,
          output: 20,
          total: 30,
        },
      },
    },
    graderResults: [
      {
        name: 'contains greeting',
        type: 'contains',
        result: {
          pass: true,
          reason: 'output includes greeting',
        },
      },
    ],
    aggregate: { pass: true, score: 1 },
    timings: {
      startedAt: '2026-03-04T00:00:00.000Z',
      endedAt: '2026-03-04T00:00:01.000Z',
      durationMs: 3455,
    },
  });

  assert.match(output, /Aggregate:\s+PASS \(score=1.00\)/);
  assert.match(output, /Metrics:/);
  assert.match(output, /latencyMs: 3455/);
  assert.match(output, /tokenUsage\.input: 10/);
  assert.match(output, /tokenUsage\.total: 30/);
  assert.match(output, /\[PASS\] contains greeting \(contains\) score=-/);
  assert.match(output, /reason: output includes greeting/);
});

test('formatTrialGraderDetails shows execution error details for failed trials', () => {
  const output = formatTrialGraderDetails({
    schemaVersion: 'trial-result.v1',
    taskId: 'file-edit-agent/smoke/modify-greeting-002',
    runId: 'run-2',
    runName: 'try-5-mini',
    trialIndex: 0,
    execution: {
      schemaVersion: 'execution-result.v1',
      output: '',
      error: {
        type: 'system',
        code: 'timeout',
        message: 'Trial timed out after 30000ms',
        retryable: false,
      },
    },
    graderResults: [],
    aggregate: { pass: false },
    timings: {
      startedAt: '2026-03-04T00:00:00.000Z',
      endedAt: '2026-03-04T00:00:30.000Z',
      durationMs: 30000,
    },
  });

  assert.match(output, /Aggregate:\s+FAIL \(score=-\)/);
  assert.match(output, /Error:/);
  assert.match(output, /Type:\s+system/);
  assert.match(output, /Code:\s+timeout/);
  assert.match(output, /Retryable:\s+no/);
  assert.match(output, /Message:\s+Trial timed out after 30000ms/);
  assert.match(output, /Graders:\n  \(no grader results\)/);
});

test('formatRunSummaryDetails includes metrics for each trial', () => {
  const output = formatRunSummaryDetails(
    {
      schemaVersion: 'run-summary.v1',
      runId: 'run-1',
      taskId: 'task-001',
      runName: 'try-5-mini',
      totalTrials: 2,
      passRate: 1,
      avgLatencyMs: 20,
    },
    {
      suiteName: 'suite-a',
      taskId: 'task-001',
    },
    [
      {
        runId: 'run-1',
        trial: {
          schemaVersion: 'trial-result.v1',
          taskId: 'task-001',
          runId: 'run-1',
          runName: 'try-5-mini',
          trialIndex: 0,
          execution: {
            schemaVersion: 'execution-result.v1',
            output: 'ok',
            metrics: {
              latencyMs: 10,
              model: 'gpt-5-mini',
            },
          },
          graderResults: [],
          aggregate: { pass: true },
          timings: {
            startedAt: '2026-03-04T00:00:00.000Z',
            endedAt: '2026-03-04T00:00:01.000Z',
            durationMs: 10,
          },
        },
      },
      {
        runId: 'run-1',
        trial: {
          schemaVersion: 'trial-result.v1',
          taskId: 'task-001',
          runId: 'run-1',
          runName: 'try-5-mini',
          trialIndex: 1,
          execution: {
            schemaVersion: 'execution-result.v1',
            output: 'ok',
            metrics: {
              latencyMs: 30,
              tokenUsage: {
                input: 1,
                output: 2,
                total: 3,
              },
            },
          },
          graderResults: [],
          aggregate: { pass: true },
          timings: {
            startedAt: '2026-03-04T00:00:02.000Z',
            endedAt: '2026-03-04T00:00:03.000Z',
            durationMs: 30,
          },
        },
      },
    ],
  );

  assert.match(output, /Run ID:\s+run-1/);
  assert.match(output, /Metrics:/);
  assert.match(output, /Trial #0:/);
  assert.match(output, /model: gpt-5-mini/);
  assert.match(output, /Trial #1:/);
  assert.match(output, /tokenUsage\.output: 2/);
});
