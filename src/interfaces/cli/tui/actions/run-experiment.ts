import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import * as p from '@clack/prompts';
import { parse as parseYaml } from 'yaml';

import type { CoreApi } from '../../../../core/api/index.js';
import { validateExperimentDefinition } from '../../../../core/validation/experiment-validator.js';
import { formatSummaryNote } from '../formatters.js';
import { discoverExperimentFiles, handleCancel } from '../utils.js';

function resolveDatasetsRoot(): string {
  const envValue = process.env.YOUEVAL_DATASETS_ROOT?.trim();
  if (envValue && envValue.length > 0) {
    p.log.info(`Using datasets root from YOUEVAL_DATASETS_ROOT: ${envValue}`);
    return envValue;
  }
  return '';
}

export async function runExperiment(core: CoreApi): Promise<void> {
  const files = await discoverExperimentFiles();

  let experimentPath: string;

  if (files.length > 0) {
    const selected = handleCancel(
      await p.select({
        message: 'Select an experiment file:',
        options: [
          ...files.map((f) => ({ value: f, label: f })),
          { value: '__manual__' as const, label: 'Enter path manually…' },
        ],
      }),
    );

    if (selected === '__manual__') {
      experimentPath = handleCancel(
        await p.text({
          message: 'Enter the experiment YAML file path:',
          placeholder: 'experiments/my-experiment.yaml',
        }),
      );
    } else {
      experimentPath = selected;
    }
  } else {
    experimentPath = handleCancel(
      await p.text({
        message: 'Enter the experiment YAML file path:',
        placeholder: 'experiments/my-experiment.yaml',
      }),
    );
  }

  const absolutePath = resolve(experimentPath);
  const rawYaml = await readFile(absolutePath, 'utf-8');
  const parsed = parseYaml(rawYaml);
  const experiment = validateExperimentDefinition(parsed);

  const runName = handleCancel(
    await p.select({
      message: 'Select a run to execute:',
      options: experiment.runs.map((r) => ({
        value: r.name,
        label: r.name,
      })),
    }),
  );

  let datasetsRoot = resolveDatasetsRoot();
  if (!datasetsRoot) {
    datasetsRoot = handleCancel(
      await p.text({
        message: 'Enter the datasets root directory path:',
        placeholder: './datasets',
        validate(value) {
          if (!value || value.trim().length === 0) {
            return 'Datasets root cannot be empty.';
          }
        },
      }),
    ).trim();
  }

  const s = p.spinner();
  let completedTasks = 0;
  let totalTasks = 0;
  const completedTaskIds = new Set<string>();

  s.start('Starting run…');

  for await (const event of core.streamRun({ experiment, runName, datasetsRoot })) {
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
