import * as p from '@clack/prompts';

import type { CoreApi, RunRecord } from '@youeval/core';
import { formatRunsTable } from '../formatters.js';
import { createLiveRegion } from '../live-region.js';
import { type RunMetadata, readRunMetadataMap } from '../run-metadata.js';
import {
  formatTaskRunHeader,
  getSpinnerFrameCount,
  type RunPanelIndicatorState,
} from '../task-run-panel.js';
import { CancelError, handleCancel } from '../utils.js';

const ESCAPE_CHAR = '\u001b';
const CTRL_C_CHAR = '\u0003';
const SPINNER_INTERVAL_MS = 80;

interface CancelWatcher {
  waitForCancel: Promise<void>;
  dispose: () => void;
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

function splitLogLines(message: string): string[] {
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function routeConsoleToPanel(
  getRunName: () => string,
  onLog: (line: string) => void,
): { restore: () => void } {
  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];
  const original: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};

  for (const method of methods) {
    original[method] = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const level = method === 'log' ? 'info' : method;
      const message = `[${getRunName()}] [${level}] ${formatConsoleArgs(args)}`;
      onLog(message);
    };
  }

  return {
    restore: () => {
      for (const method of methods) {
        const fn = original[method];
        if (fn) {
          console[method] = fn;
        }
      }
    },
  };
}

function createRunCancelWatcher(): CancelWatcher | null {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return null;
  }

  const previousIsRaw = Boolean((stdin as NodeJS.ReadStream & { isRaw?: boolean }).isRaw);
  let settled = false;
  let resolveCancel!: () => void;
  const waitForCancel = new Promise<void>((resolve) => {
    resolveCancel = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
  });

  const onData = (chunk: Buffer): void => {
    const input = chunk.toString('utf8');
    if (input.includes(ESCAPE_CHAR) || input.includes(CTRL_C_CHAR)) {
      resolveCancel();
    }
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);

  const dispose = (): void => {
    stdin.off('data', onData);
    stdin.setRawMode(previousIsRaw);
  };

  return { waitForCancel, dispose };
}

function formatTaskHint(task: { runCount: number; desc?: string; capability?: string }): string {
  const parts = [`${task.runCount} run${task.runCount === 1 ? '' : 's'}`];
  if (task.capability) {
    parts.push(`capability: ${task.capability}`);
  }
  if (task.desc) {
    parts.push(task.desc);
  }
  return parts.join(' | ');
}

export async function runTask(core: CoreApi): Promise<void> {
  const suites = await core.suites.list();
  if (suites.length === 0) {
    p.log.warn('No suites found.');
    return;
  }

  const selectedSuite = handleCancel(
    await p.select({
      message: 'Select a suite:',
      options: suites.map((suite) => ({
        value: suite,
        label: suite.name,
        hint: suite.id,
      })),
    }),
  );

  const loadedSuite = await core.suites.load(selectedSuite.id);
  const tasks = await loadedSuite.listTasks();
  if (tasks.length === 0) {
    p.log.warn(`No tasks found in suite '${selectedSuite.id}'.`);
    return;
  }

  const selectedTask = handleCancel(
    await p.select({
      message: 'Select a task:',
      options: tasks.map((task) => ({
        value: task,
        label: task.id,
        hint: formatTaskHint(task),
      })),
    }),
  );

  let activeRunName = 'pending';
  let completedTrials = 0;
  let totalTrials = 0;
  let indicatorState: RunPanelIndicatorState = 'pending';
  let spinnerFrameIndex = 0;
  const runLogs: string[] = [];
  const completedRuns: RunRecord[] = [];
  const liveRegion = createLiveRegion();

  const renderPanel = (): void => {
    const lines = [
      formatTaskRunHeader({
        taskId: selectedTask.id,
        runName: activeRunName,
        completedTrials,
        totalTrials,
        indicatorState,
        spinnerFrameIndex,
      }),
      '',
      ...(runLogs.length > 0 ? runLogs : ['(waiting for console logs...)']),
    ];
    liveRegion.render(lines.join('\n'));
  };

  const appendLog = (line: string): void => {
    for (const item of splitLogLines(line)) {
      runLogs.push(item);
    }
    renderPanel();
  };

  const { restore } = routeConsoleToPanel(() => activeRunName, appendLog);
  renderPanel();
  const spinnerTimer =
    process.stdout.isTTY === true
      ? setInterval(() => {
          if (indicatorState !== 'running') {
            return;
          }
          spinnerFrameIndex = (spinnerFrameIndex + 1) % getSpinnerFrameCount();
          renderPanel();
        }, SPINNER_INTERVAL_MS)
      : null;
  spinnerTimer?.unref();
  const cancelWatcher = createRunCancelWatcher();
  const streamAbortController = new AbortController();
  const streamIterator = loadedSuite
    .streamTask(selectedTask.id, { signal: streamAbortController.signal })
    [Symbol.asyncIterator]();
  const cancelledToken = Symbol('cancelled');
  let runCancelledByUser = false;

  try {
    while (true) {
      const nextResult = cancelWatcher
        ? await Promise.race([
            streamIterator.next(),
            cancelWatcher.waitForCancel.then(() => cancelledToken),
          ])
        : await streamIterator.next();

      if (typeof nextResult === 'symbol') {
        runCancelledByUser = true;
        streamAbortController.abort();
        break;
      }

      if (nextResult.done) {
        break;
      }

      const event = nextResult.value;
      switch (event.type) {
        case 'run:started':
          activeRunName = event.runName;
          totalTrials = event.totalTrials;
          completedTrials = 0;
          indicatorState = 'running';
          spinnerFrameIndex = 0;
          renderPanel();
          break;
        case 'trial:started':
          activeRunName = event.runName;
          indicatorState = 'running';
          renderPanel();
          break;
        case 'trial:completed':
          activeRunName = event.runName;
          completedTrials += 1;
          renderPanel();
          break;
        case 'trial:error':
          activeRunName = event.runName;
          completedTrials += 1;
          renderPanel();
          break;
        case 'run:completed':
          activeRunName = event.summary.runName;
          completedTrials = totalTrials;
          indicatorState = 'completed';
          completedRuns.push({
            runId: event.summary.runId,
            status: 'completed',
            manifest: null,
            summary: event.summary,
          });
          renderPanel();
          break;
      }
    }

    if (runCancelledByUser) {
      liveRegion.clear();
      p.log.warn(`${selectedTask.id} cancelled`);
      throw new CancelError();
    }
  } catch (error) {
    if (error instanceof CancelError) {
      throw error;
    }
    liveRegion.clear();
    p.log.error(`${selectedTask.id} failed`);
    throw error;
  } finally {
    if (runCancelledByUser) {
      await streamIterator.return?.();
    }
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
    }
    cancelWatcher?.dispose();
    liveRegion.clear();
    restore();
  }

  p.log.success(`${selectedTask.id} completed`);

  if (completedRuns.length === 0) {
    return;
  }

  const metadata = await readRunMetadataMap(
    core,
    completedRuns.map((record) => record.runId),
  );

  for (const record of completedRuns) {
    if (!metadata.has(record.runId)) {
      metadata.set(record.runId, {
        suiteName: loadedSuite.definition.name,
        taskId: selectedTask.id,
      } satisfies RunMetadata);
    }
  }

  p.note(formatRunsTable(completedRuns, metadata), `Task Results: ${selectedTask.id}`);
}
