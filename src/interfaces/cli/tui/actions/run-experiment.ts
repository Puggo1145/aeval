import * as p from '@clack/prompts';

import type { CoreApi, LoadedExperiment } from '../../../../core/api/index.js';
import type { RunSummary, RunSummaryRecord } from '../../../../core/contracts/run-summary.js';
import { formatRunsTable } from '../formatters.js';
import { handleCancel } from '../utils.js';

const RUN_ALL_VALUE = '__run_all__';
const RUN_PROGRESS_BAR_WIDTH = 24;
const ANSI_MAGENTA = '\x1b[35m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

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

function formatProgressBar(completed: number, total: number): string {
  const safeTotal = Math.max(total, 1);
  const clampedCompleted = Math.max(0, Math.min(completed, safeTotal));
  const ratio = clampedCompleted / safeTotal;
  const filled = Math.round(ratio * RUN_PROGRESS_BAR_WIDTH);
  const empty = Math.max(0, RUN_PROGRESS_BAR_WIDTH - filled);
  const filledBar = '━'.repeat(filled);
  const remainingBar = '━'.repeat(empty);
  return `${ANSI_MAGENTA}${filledBar}${ANSI_RESET}${ANSI_DIM}${remainingBar}${ANSI_RESET} ${clampedCompleted}/${total} tasks`;
}

function splitLogLines(message: string): string[] {
  return message
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function routeConsoleToPanel(
  runName: string,
  onLog: (line: string) => void,
): { restore: () => void } {
  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];
  const original: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};

  for (const method of methods) {
    original[method] = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const level = method === 'log' ? 'info' : method;
      const message = `[${runName}] [${level}] ${formatConsoleArgs(args)}`;
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

export async function runExperiment(core: CoreApi): Promise<void> {
  const experiments = core.experiments;

  if (experiments.length === 0) {
    p.log.warn('No experiments loaded.');
    return;
  }

  let experiment: LoadedExperiment;

  if (experiments.length === 1) {
    experiment = experiments[0]!;
  } else {
    experiment = handleCancel(
      await p.select({
        message: 'Select an experiment:',
        options: experiments.map((exp) => ({
          value: exp,
          label: exp.definition.name,
        })),
      }),
    );
  }

  const selectedRuns = handleCancel(
    await p.multiselect({
      message: 'Select run(s) to execute:',
      options: [
        {
          value: RUN_ALL_VALUE,
          label: 'Run all',
          hint: `${experiment.definition.runs.length} runs`,
        },
        ...experiment.definition.runs.map((r) => ({
          value: r.name,
          label: r.name,
        })),
      ],
      required: true,
    }),
  );

  const runNames = selectedRuns.includes(RUN_ALL_VALUE)
    ? experiment.definition.runs.map((r) => r.name)
    : selectedRuns;
  const completedSummaries: RunSummaryRecord[] = [];

  for (const [runIndex, runName] of runNames.entries()) {
    const runLabel = `Run ${runIndex + 1}/${runNames.length}: ${runName}`;
    const runSpinner = p.spinner();
    let completedTasks = 0;
    let totalTasks = 0;
    const runLogs: string[] = [];
    const completedTaskIds = new Set<string>();
    let completedSummary: RunSummary | undefined;

    const renderPanel = (): void => {
      const lines = [
        `${runLabel}  ${formatProgressBar(completedTasks, totalTasks)}`,
        '',
        ...(runLogs.length > 0 ? runLogs : ['(waiting for console logs...)']),
      ];
      runSpinner.message(lines.join('\n'));
    };

    const appendLog = (line: string): void => {
      for (const item of splitLogLines(line)) {
        runLogs.push(item);
      }
      renderPanel();
    };

    const { restore } = routeConsoleToPanel(runName, appendLog);
    runSpinner.start(`${runLabel} starting...`);
    renderPanel();

    try {
      for await (const event of experiment.stream(runName)) {
        switch (event.type) {
          case 'run:started':
            totalTasks = event.totalTasks;
            renderPanel();
            break;
          case 'trial:completed':
            if (!completedTaskIds.has(event.taskId)) {
              completedTaskIds.add(event.taskId);
              completedTasks = completedTaskIds.size;
            }
            renderPanel();
            break;
          case 'trial:error':
            if (!completedTaskIds.has(event.taskId)) {
              completedTaskIds.add(event.taskId);
              completedTasks = completedTaskIds.size;
            }
            renderPanel();
            break;
          case 'run:completed':
            runSpinner.stop(`${runLabel} completed`);
            completedSummary = event.summary;
            break;
        }
      }
    } catch (error) {
      runSpinner.error(`${runLabel} failed`);
      throw error;
    } finally {
      restore();
    }

    if (completedSummary) {
      completedSummaries.push({
        runId: completedSummary.runId,
        summary: completedSummary,
      });
    }
  }

  if (completedSummaries.length === 0) {
    return;
  }

  const experimentsByRunId = new Map(
    completedSummaries.map((record) => [record.runId, experiment.definition.name] as const),
  );
  p.note(
    formatRunsTable(completedSummaries, experimentsByRunId),
    `Experiment Results: ${experiment.definition.name}`,
  );
}
