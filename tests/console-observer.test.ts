import assert from 'node:assert/strict';
import test from 'node:test';

import { ConsoleObserver } from '../src/adapters/observer/console-observer.js';
import { RunEvents } from '../src/core/contracts/runtime.js';

test('console observer logs run:started with task and trial counts', () => {
  const observer = new ConsoleObserver();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };

  try {
    observer.onEvent(RunEvents.started('run-1', 'task-001', 'mini', 3));
  } finally {
    console.log = originalLog;
  }

  assert.match(logs[0] ?? '', /task=task-001/);
  assert.match(logs[0] ?? '', /trials=3/);
});

test('console observer logs trial:error with runName', () => {
  const observer = new ConsoleObserver();
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.join(' '));
  };

  try {
    observer.onEvent(RunEvents.trialError('task-001', 'run-1', 'mini', 1, 'system', 'timeout'));
  } finally {
    console.error = originalError;
  }

  assert.match(errors[0] ?? '', /run=mini/);
  assert.match(errors[0] ?? '', /timeout/);
});

test('console observer logs run:completed using task-run summary fields', () => {
  const observer = new ConsoleObserver();
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(' '));
  };

  try {
    observer.onEvent(
      RunEvents.completed({
        schemaVersion: 'run-summary.v1',
        runId: 'run-1',
        taskId: 'task-001',
        runName: 'mini',
        totalTrials: 2,
        passRate: 1,
      }),
    );
  } finally {
    console.log = originalLog;
  }

  assert.match(logs[0] ?? '', /task=task-001/);
  assert.match(logs[0] ?? '', /totalTrials=2/);
});
