import * as p from '@clack/prompts';

import type { CoreApi, LoadedExperiment } from '../../../../core/api/index.js';
import { formatSummaryNote } from '../formatters.js';
import { handleCancel } from '../utils.js';

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

  const runName = handleCancel(
    await p.select({
      message: 'Select a run to execute:',
      options: experiment.definition.runs.map((r) => ({
        value: r.name,
        label: r.name,
      })),
    }),
  );

  const s = p.spinner();
  let completedTasks = 0;
  let totalTasks = 0;
  const completedTaskIds = new Set<string>();

  s.start('Starting run…');

  for await (const event of experiment.stream(runName)) {
    switch (event.type) {
      case 'run:started':
        totalTasks = event.totalTasks;
        s.message(`Running: 0/${totalTasks} tasks completed`);
        break;
      case 'trial:completed':
        if (!completedTaskIds.has(event.taskId)) {
          completedTaskIds.add(event.taskId);
          completedTasks = completedTaskIds.size;
        }
        s.message(`Running: ${completedTasks}/${totalTasks} tasks completed`);
        break;
      case 'trial:error':
        if (!completedTaskIds.has(event.taskId)) {
          completedTaskIds.add(event.taskId);
          completedTasks = completedTaskIds.size;
        }
        s.message(`Running: ${completedTasks}/${totalTasks} tasks completed`);
        p.log.warn(
          `Trial error: ${event.taskId} #${event.trialIndex} [${event.errorType}] ${event.message}`,
        );
        break;
      case 'run:completed':
        s.stop('Run completed.');
        formatSummaryNote(event.summary);
        break;
    }
  }
}
