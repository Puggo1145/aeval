import * as p from '@clack/prompts';

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
  run: (core) => runExperiment(core),
  report: (core) => viewReport(core),
  runs: (core) => listRuns(core),
  trials: (core) => viewTrials(core),
  'baseline-set': (core) => setBaseline(core),
  'baseline-compare': (core) => compareBaseline(core),
};

export async function runTui(core: CoreApi): Promise<void> {
  p.intro('YouEval — Interactive Mode');

  let running = true;
  while (running) {
    const hasLoadedExperiments = core.experiments.length > 0;
    const action = await p.select({
      message: 'What would you like to do?',
      options: [
        {
          value: 'run',
          label: hasLoadedExperiments
            ? 'Run an experiment'
            : 'Run an experiment (no experiment loaded)',
        },
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

    if (action === 'run' && !hasLoadedExperiments) {
      p.log.warn(
        "No experiment loaded. Load one with `core.loadExperiment(...)` before entering TUI run flow.",
      );
      continue;
    }

    const handler = ACTIONS[action];
    if (!handler) {
      continue;
    }

    try {
      await handler(core);
    } catch (error) {
      if (error instanceof CancelError) {
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
