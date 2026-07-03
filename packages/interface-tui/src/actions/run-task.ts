import type { CoreApi, RunRecord } from '@aeval/core';
import * as p from '@clack/prompts';
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

  const selectedTasks = handleCancel(
    await p.multiselect({
      message: 'Select tasks:',
      options: tasks.map((task) => ({
        value: task,
        label: task.id,
        hint: formatTaskHint(task),
      })),
      required: true,
    }),
  );

  const taskConcurrency = await promptTaskConcurrency(selectedTasks.length);
  const selectedTaskIds = selectedTasks.map((task) => task.id);

  // Tasks and their runs execute in parallel and their events interleave, so
  // progress is tracked per runId, grouped by task, and each task renders its
  // own progress line.
  interface RunProgress {
    name: string;
    total: number;
    completed: number;
    done: boolean;
  }
  const taskProgress = new Map<string, Map<string, RunProgress>>();
  for (const task of selectedTasks) {
    taskProgress.set(task.id, new Map());
  }
  let activeRunName = 'pending';
  let spinnerFrameIndex = 0;
  const runLogs: string[] = [];
  const completedRuns: RunRecord[] = [];
  const liveRegion = createLiveRegion();

  const anyRunning = (): boolean => {
    for (const runs of taskProgress.values()) {
      for (const run of runs.values()) {
        if (!run.done) {
          return true;
        }
      }
    }
    return false;
  };

  const taskIndicator = (runs: Map<string, RunProgress>): RunPanelIndicatorState => {
    if (runs.size === 0) {
      return 'pending';
    }
    return [...runs.values()].every((run) => run.done) ? 'completed' : 'running';
  };

  const taskRunLabel = (runs: Map<string, RunProgress>): string => {
    if (runs.size === 0) {
      return 'pending';
    }
    const active = [...runs.values()].filter((run) => !run.done);
    if (active.length === 0) {
      return 'done';
    }
    if (active.length === 1) {
      return active[0]!.name;
    }
    return `${active.length} runs`;
  };

  const renderPanel = (): void => {
    const headerLines: string[] = [];
    for (const [taskId, runs] of taskProgress) {
      let completedTrials = 0;
      let totalTrials = 0;
      for (const run of runs.values()) {
        completedTrials += run.completed;
        totalTrials += run.total;
      }
      headerLines.push(
        formatTaskRunHeader({
          taskId,
          runName: taskRunLabel(runs),
          completedTrials,
          totalTrials,
          indicatorState: taskIndicator(runs),
          spinnerFrameIndex,
        }),
      );
    }

    const lines = [
      ...headerLines,
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
          if (!anyRunning()) {
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
    .streamTasks(selectedTaskIds, {
      signal: streamAbortController.signal,
      ...(taskConcurrency !== undefined ? { taskConcurrency } : {}),
    })
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
        case 'run:started': {
          taskProgress.get(event.taskId)?.set(event.runId, {
            name: event.runName,
            total: event.totalTrials,
            completed: 0,
            done: false,
          });
          activeRunName = event.runName;
          renderPanel();
          break;
        }
        case 'trial:started':
          activeRunName = event.runName;
          renderPanel();
          break;
        case 'trial:completed':
        case 'trial:error': {
          activeRunName = event.runName;
          const progress = taskProgress.get(event.taskId)?.get(event.runId);
          if (progress) {
            progress.completed += 1;
          }
          renderPanel();
          break;
        }
        case 'run:completed': {
          activeRunName = event.summary.runName;
          const progress = taskProgress.get(event.summary.taskId)?.get(event.summary.runId);
          if (progress) {
            progress.completed = progress.total;
            progress.done = true;
          }
          completedRuns.push({
            runId: event.summary.runId,
            manifest: null,
            summary: event.summary,
          });
          renderPanel();
          break;
        }
      }
    }

    if (runCancelledByUser) {
      liveRegion.clear();
      p.log.warn('Run cancelled');
      throw new CancelError();
    }
  } catch (error) {
    if (error instanceof CancelError) {
      throw error;
    }
    liveRegion.clear();
    p.log.error('Run failed');
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

  p.log.success(`Completed ${selectedTasks.length} task${selectedTasks.length === 1 ? '' : 's'}`);

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
        suiteName: loadedSuite.name,
        ...(record.summary?.taskId ? { taskId: record.summary.taskId } : {}),
      } satisfies RunMetadata);
    }
  }

  p.note(formatRunsTable(completedRuns, metadata), 'Task Results');
}

// Ask how many tasks may run in parallel; blank means all at once. Only
// prompted when more than one task is selected.
async function promptTaskConcurrency(taskCount: number): Promise<number | undefined> {
  if (taskCount <= 1) {
    return undefined;
  }

  const answer = handleCancel(
    await p.text({
      message: 'Max tasks to run in parallel:',
      placeholder: 'all',
      defaultValue: '',
      validate: (value) => {
        const trimmed = (value ?? '').trim();
        if (trimmed === '') {
          return undefined;
        }
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return 'Enter a positive integer, or leave blank to run all at once.';
        }
        return undefined;
      },
    }),
  );

  const trimmed = answer.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}
