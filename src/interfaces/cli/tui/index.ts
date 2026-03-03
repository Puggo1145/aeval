import * as p from '@clack/prompts';

import { createAppCore } from '../../../bootstrap/create-app-core.js';
import type { CoreApi } from '../../../core/api/index.js';

import { compareBaseline } from './actions/compare-baseline.js';
import { listRuns } from './actions/list-runs.js';
import { runExperiment } from './actions/run-experiment.js';
import { setBaseline } from './actions/set-baseline.js';
import { viewReport } from './actions/view-report.js';
import { viewTrials } from './actions/view-trials.js';
import { CancelError } from './utils.js';

type Action = (core: CoreApi) => Promise<void>;

const ACTIONS: Record<string, Action> = {
  run: runExperiment,
  report: viewReport,
  runs: listRuns,
  trials: viewTrials,
  'baseline-set': setBaseline,
  'baseline-compare': compareBaseline,
};

export async function runTui(): Promise<void> {
  p.intro('YouEval — Interactive Mode');

  const core = createAppCore();

  let running = true;
  while (running) {
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        { value: 'run', label: 'Run an experiment' },
        { value: 'report', label: 'View run report' },
        { value: 'runs', label: 'List all runs' },
        { value: 'trials', label: 'View trial details' },
        { value: 'baseline-set', label: 'Set baseline' },
        { value: 'baseline-compare', label: 'Compare with baseline' },
        { value: 'exit', label: 'Exit' },
      ],
    });

    if (p.isCancel(action) || action === 'exit') {
      running = false;
      break;
    }

    const handler = ACTIONS[action];
    if (!handler) {
      continue;
    }

    try {
      await handler(core);
    } catch (error) {
      if (error instanceof CancelError) {
        // action cancelled, return to menu
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(message);
    }

    const shouldContinue = await p.confirm({
      message: 'Continue?',
      initialValue: true,
    });

    if (p.isCancel(shouldContinue) || !shouldContinue) {
      running = false;
    }
  }

  p.outro('Goodbye!');
}
