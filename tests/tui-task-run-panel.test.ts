import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatTaskRunHeader,
  getSpinnerFrameCount,
} from '../packages/interface-tui/src/task-run-panel.js';

test('formatTaskRunHeader renders animated spinner before the progress bar while running', () => {
  const output = formatTaskRunHeader({
    taskId: 'suite/task-001',
    runName: 'gpt-4o-mini',
    completedTrials: 1,
    totalTrials: 3,
    indicatorState: 'running',
    spinnerFrameIndex: 1,
  });

  assert.match(output, /suite\/task-001 · gpt-4o-mini/u);
  assert.match(output, /⠙/u);
  assert.match(output, /1\/3 trials/u);
});

test('formatTaskRunHeader renders a completed mark after the run finishes', () => {
  const output = formatTaskRunHeader({
    taskId: 'suite/task-001',
    runName: 'gpt-4o-mini',
    completedTrials: 3,
    totalTrials: 3,
    indicatorState: 'completed',
    spinnerFrameIndex: 0,
  });

  assert.match(output, /✓/u);
  assert.match(output, /3\/3 trials/u);
});

test('getSpinnerFrameCount exposes a stable positive frame count', () => {
  assert.equal(getSpinnerFrameCount() > 0, true);
});
