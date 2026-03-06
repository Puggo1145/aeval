import assert from 'node:assert/strict';
import test from 'node:test';

import { createConsoleObserverAdapter } from '../src/adapters/observer/console-observer.js';
import type { RunEvent } from '../src/core/contracts/runtime.js';

test('console observer logs run:started with task and trial counts', () => {
  const observer = createConsoleObserverAdapter();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };

  try {
    const event: RunEvent = {
      type: 'run:started',
      runId: 'run-1',
      taskId: 'task-001',
      runName: 'mini',
      totalTrials: 3,
    };
    observer.onEvent(event);
  } finally {
    console.log = originalLog;
  }

  assert.match(logs[0] ?? '', /taskId=task-001/);
  assert.match(logs[0] ?? '', /totalTrials=3/);
});

test('console observer logs trial:error with runName', () => {
  const observer = createConsoleObserverAdapter();
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };

  try {
    observer.onEvent({
      type: 'trial:error',
      taskId: 'task-001',
      runId: 'run-1',
      runName: 'mini',
      trialIndex: 1,
      errorType: 'system',
      message: 'timeout',
    });
  } finally {
    console.error = originalError;
  }

  assert.match(logs[0] ?? '', /run=mini/);
  assert.match(logs[0] ?? '', /timeout/);
});

test('console observer logs run:completed using task-run summary fields', () => {
  const observer = createConsoleObserverAdapter();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };

  try {
    observer.onEvent({
      type: 'run:completed',
      summary: {
        schemaVersion: 'run-summary.v1',
        runId: 'run-1',
        taskId: 'task-001',
        runName: 'mini',
        totalTrials: 2,
        passRate: 1,
      },
    });
  } finally {
    console.log = originalLog;
  }

  assert.match(logs[0] ?? '', /taskId=task-001/);
  assert.match(logs[0] ?? '', /totalTrials=2/);
});
