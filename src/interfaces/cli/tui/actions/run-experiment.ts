import * as p from '@clack/prompts';

import type { CoreApi, LoadedExperiment } from '../../../../core/api/index.js';
import { formatSummaryNote } from '../formatters.js';
import { handleCancel } from '../utils.js';

const RUN_ALL_VALUE = '__run_all__';
const BUFFERED_LOG_PREVIEW_LIMIT = 10;

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

function silenceConsole(): { restore: () => string[] } {
  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];
  const original: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  const buffered: string[] = [];

  for (const method of methods) {
    original[method] = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const message = args
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
      buffered.push(`[${method}] ${message}`);
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
      return buffered;
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

  for (const [runIndex, runName] of runNames.entries()) {
    const runLabel = `Run ${runIndex + 1}/${runNames.length}: ${runName}`;
    const runWarnings: string[] = [];
    let progressBar: ReturnType<typeof p.progress> | undefined;
    let completedTasks = 0;
    let totalTasks = 0;
    const completedTaskIds = new Set<string>();
    const { restore } = silenceConsole();

    try {
      for await (const event of experiment.stream(runName)) {
        switch (event.type) {
          case 'run:started':
            totalTasks = event.totalTasks;
            progressBar = p.progress({ max: Math.max(totalTasks, 1) });
            progressBar.start(`${runLabel}  0/${totalTasks} tasks`);
            break;
          case 'trial:completed':
            if (!completedTaskIds.has(event.taskId)) {
              completedTaskIds.add(event.taskId);
              completedTasks = completedTaskIds.size;
              progressBar?.advance(1, `${runLabel}  ${completedTasks}/${totalTasks} tasks`);
            } else {
              progressBar?.message(`${runLabel}  ${completedTasks}/${totalTasks} tasks`);
            }
            break;
          case 'trial:error':
            runWarnings.push(
              `Trial error: ${event.taskId} #${event.trialIndex} [${event.errorType}] ${event.message}`,
            );
            if (!completedTaskIds.has(event.taskId)) {
              completedTaskIds.add(event.taskId);
              completedTasks = completedTaskIds.size;
              progressBar?.advance(1, `${runLabel}  ${completedTasks}/${totalTasks} tasks`);
            } else {
              progressBar?.message(`${runLabel}  ${completedTasks}/${totalTasks} tasks`);
            }
            break;
          case 'run:completed':
            progressBar?.stop(`${runLabel} completed`);
            formatSummaryNote(event.summary);
            break;
        }
      }
    } catch (error) {
      progressBar?.error(`${runLabel} failed`);
      throw error;
    } finally {
      const bufferedLogs = restore();
      if (runWarnings.length > 0) {
        p.note(runWarnings.join('\n'), `Run Warnings: ${runName}`);
      }
      if (bufferedLogs.length > 0) {
        const preview = bufferedLogs.slice(-BUFFERED_LOG_PREVIEW_LIMIT).join('\n');
        const omitted = bufferedLogs.length - BUFFERED_LOG_PREVIEW_LIMIT;
        const message =
          omitted > 0
            ? `${preview}\n... ${omitted} more line(s) omitted`
            : preview;
        p.note(message, `Buffered Console Logs: ${runName}`);
      }
    }
  }
}
