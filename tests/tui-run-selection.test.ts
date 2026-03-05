import assert from 'node:assert/strict';
import test from 'node:test';

import { groupRunsByExperiment } from '../src/interfaces/cli/tui/run-selection.js';

test('groupRunsByExperiment groups by experiment name and falls back to unknown', () => {
  const records = [
    {
      runId: 'run-1',
      summary: {
        schemaVersion: 'run-summary.v1' as const,
        runId: 'run-1',
        runName: 'smoke',
        totalTasks: 1,
        totalTrials: 1,
        passRate: 1,
      },
    },
    {
      runId: 'run-2',
      summary: {
        schemaVersion: 'run-summary.v1' as const,
        runId: 'run-2',
        runName: 'smoke',
        totalTasks: 1,
        totalTrials: 1,
        passRate: 1,
      },
    },
    {
      runId: 'run-3',
      summary: {
        schemaVersion: 'run-summary.v1' as const,
        runId: 'run-3',
        runName: 'smoke',
        totalTasks: 1,
        totalTrials: 1,
        passRate: 1,
      },
    },
  ];

  const groups = groupRunsByExperiment(
    records,
    new Map<string, string>([
      ['run-1', 'exp-a'],
      ['run-2', 'exp-a'],
      ['run-3', ''],
    ]),
  );

  assert.deepEqual(groups.map((group) => group.experiment), ['exp-a', 'unknown']);
  assert.deepEqual(
    groups.map((group) => group.runs.map((record) => record.runId)),
    [
      ['run-1', 'run-2'],
      ['run-3'],
    ],
  );
});
