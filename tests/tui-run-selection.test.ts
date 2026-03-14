import assert from 'node:assert/strict';
import test from 'node:test';

import { groupRunsBySuiteAndTask } from '../packages/interface-tui/src/run-selection.js';

test('groupRunsBySuiteAndTask groups runs by suite then task and falls back to unknown', () => {
  const records = [
    {
      runId: 'run-1',
      status: 'completed' as const,
      manifest: null,
      summary: {
        schemaVersion: 'run-summary.v1' as const,
        runId: 'run-1',
        taskId: 'task-001',
        runName: 'mini',
        totalTrials: 1,
        passRate: 1,
      },
    },
    {
      runId: 'run-2',
      status: 'completed' as const,
      manifest: null,
      summary: {
        schemaVersion: 'run-summary.v1' as const,
        runId: 'run-2',
        taskId: 'task-001',
        runName: 'nano',
        totalTrials: 1,
        passRate: 1,
      },
    },
    {
      runId: 'run-3',
      status: 'interrupted' as const,
      manifest: {
        schemaVersion: 'run-manifest.v1' as const,
        runId: 'run-3',
        suiteId: 'suite-b',
        suiteName: 'Suite B',
        taskId: 'task-002',
        runName: 'mini',
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
    },
  ];

  const groups = groupRunsBySuiteAndTask(
    records,
    new Map([
      ['run-1', { suiteName: 'suite-a', taskId: 'task-001' }],
      ['run-2', { suiteName: 'suite-a', taskId: 'task-001' }],
      ['run-3', { suiteName: '', taskId: '' }],
    ]),
  );

  assert.deepEqual(groups.map((group) => group.suite), ['suite-a', 'unknown']);
  assert.deepEqual(groups[0]?.tasks.map((task) => task.task), ['task-001']);
  assert.deepEqual(groups[0]?.tasks[0]?.runs.map((run) => run.runId), ['run-1', 'run-2']);
  assert.deepEqual(groups[1]?.tasks.map((task) => task.task), ['task-002']);
});
