import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
  assert.match(output, /file-edit-agent\/smoke\/create-hello-001/);
  assert.match(output, /\bPASS\b/);
  assert.match(output, /8571ms/);
});

test('formatRunsTable includes suite and task columns', () => {
  const output = formatRunsTable(
    [
      {
        runId: 'run-1',
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

  assert.match(output, /^Run ID\s+Suite\s+Task\s+Run Name\s+Pass Rate\s+Trials/m);
  assert.match(output, /file-edit-agent/);
});

test('formatRunOptionHint falls back to unknown suite and task when missing', () => {
  assert.equal(formatRunOptionHint(undefined), 'suite: unknown | task: unknown');
});

test('formatRunOptionLabel shows human-readable run name only', () => {
  assert.equal(
    formatRunOptionLabel({
      runId: 'run-1',
      summary: {
        schemaVersion: 'run-summary.v1',
        runId: 'run-1',
        taskId: 'task-001',
        runName: 'try-5-mini',
        totalTrials: 2,
        passRate: 1,
      },
    }),
    'try-5-mini',
  );
});

test('formatRunOptionStatsHint includes pass rate, task id, and trial count', () => {
  assert.equal(
    formatRunOptionStatsHint({
      runId: 'run-1',
      summary: {
        schemaVersion: 'run-summary.v1',
        runId: 'run-1',
        taskId: 'task-001',
        runName: 'try-5-mini',
        totalTrials: 3,
        passRate: 0.5,
      },
    }),
    'pass=50.0% | task=task-001 | trials=3',
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
  assert.match(output, /\[PASS\] contains greeting \(contains\) score=-/);
  assert.match(output, /reason: output includes greeting/);
});
