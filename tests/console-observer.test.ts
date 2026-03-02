import assert from 'node:assert/strict';
import test from 'node:test';

import { createConsoleObserverAdapter } from '../src/adapters/observer/index.js';
import type { RunEvent } from '../src/core/contracts/runtime.js';

test('console observer logs run:started event', (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  const observer = createConsoleObserverAdapter();
  const event: RunEvent = { type: 'run:started', runId: 'run-1', runName: 'test', totalTasks: 3 };
  observer.onEvent(event);

  assert.equal(logs.length, 1);
  assert.ok(logs[0]?.includes('run:started'));
  assert.ok(logs[0]?.includes('run-1'));
  assert.ok(logs[0]?.includes('3'));
});

test('console observer logs trial:started event', (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  const observer = createConsoleObserverAdapter();
  observer.onEvent({ type: 'trial:started', taskId: 'task-1', trialIndex: 0 });

  assert.equal(logs.length, 1);
  assert.ok(logs[0]?.includes('trial:started'));
  assert.ok(logs[0]?.includes('task-1'));
});

test('console observer logs trial:completed event', (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  const observer = createConsoleObserverAdapter();
  observer.onEvent({
    type: 'trial:completed',
    taskId: 'task-1',
    trialIndex: 0,
    pass: true,
    durationMs: 123,
  });

  assert.equal(logs.length, 1);
  assert.ok(logs[0]?.includes('trial:completed'));
  assert.ok(logs[0]?.includes('pass=true'));
  assert.ok(logs[0]?.includes('123'));
});

test('console observer logs trial:error event to console.error', (t) => {
  const errors: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.join(' '));
  });

  const observer = createConsoleObserverAdapter();
  observer.onEvent({
    type: 'trial:error',
    taskId: 'task-1',
    trialIndex: 0,
    errorType: 'agent',
    message: 'something went wrong',
  });

  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.includes('trial:error'));
  assert.ok(errors[0]?.includes('agent'));
  assert.ok(errors[0]?.includes('something went wrong'));
});

test('console observer logs run:completed event with pass rate', (t) => {
  const logs: string[] = [];
  t.mock.method(console, 'log', (...args: unknown[]) => {
    logs.push(args.join(' '));
  });

  const observer = createConsoleObserverAdapter();
  observer.onEvent({
    type: 'run:completed',
    summary: {
      schemaVersion: 'run-summary.v1',
      runId: 'run-1',
      runName: 'test',
      totalTasks: 2,
      totalTrials: 4,
      passRate: 0.75,
    },
  });

  assert.equal(logs.length, 1);
  assert.ok(logs[0]?.includes('run:completed'));
  assert.ok(logs[0]?.includes('0.75'));
});

test('console observer onEvent returns void (not a promise)', (t) => {
  t.mock.method(console, 'log', () => {});

  const observer = createConsoleObserverAdapter();
  const result = observer.onEvent({
    type: 'run:started',
    runId: 'r',
    runName: 'n',
    totalTasks: 0,
  });

  assert.equal(result, undefined);
});
