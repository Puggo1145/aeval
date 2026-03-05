import * as p from '@clack/prompts';

import type { CoreApi } from '../../../../core/api/index.js';
import { readRunExperiments } from '../../run-metadata.js';
import {
  formatRunOptionLabel,
  formatRunOptionStatsHint,
  formatTrialGraderDetails,
  formatTrialsTable,
} from '../formatters.js';
import { groupRunsByExperiment } from '../run-selection.js';
import { handleCancel } from '../utils.js';

export async function viewTrials(core: CoreApi): Promise<void> {
  const s = p.spinner();
  s.start('Loading runs…');
  const records = await core.listRuns();
  s.stop('Runs loaded.');

  if (records.length === 0) {
    p.log.warn('No runs found.');
    return;
  }

  const experiments = await readRunExperiments(
    core,
    records.map((record) => record.runId),
  );
  const experimentGroups = groupRunsByExperiment(records, experiments);
  const selectedExperiment = handleCancel(
    await p.select({
      message: 'Select an experiment:',
      options: experimentGroups.map((group) => ({
        value: group.experiment,
        label: group.experiment,
        hint: `${group.runs.length} run${group.runs.length === 1 ? '' : 's'}`,
      })),
    }),
  );
  const runsInExperiment =
    experimentGroups.find((group) => group.experiment === selectedExperiment)?.runs ?? [];
  if (runsInExperiment.length === 0) {
    p.log.warn(`No runs found under experiment '${selectedExperiment}'.`);
    return;
  }

  const runId = handleCancel(
    await p.select({
      message: 'Select a run to view trials:',
      options: runsInExperiment.map((r) => ({
        value: r.runId,
        label: formatRunOptionLabel(r),
        hint: formatRunOptionStatsHint(r),
      })),
    }),
  );

  const trials = await core.listTrials(runId);

  if (trials.length === 0) {
    p.log.warn(`No trials found for run '${runId}'.`);
    return;
  }

  p.note(formatTrialsTable(trials), 'Trials');

  while (true) {
    const selectedIndex = handleCancel(
      await p.select<number | 'back'>({
        message: 'Select a trial to view grader results:',
        options: [
          ...trials.map((record, index) => {
            const trial = record.trial;
            return {
              value: index,
              label: `${trial.taskId} #${trial.trialIndex}`,
              hint: trial.aggregate.pass ? 'PASS' : 'FAIL',
            };
          }),
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (selectedIndex === 'back') {
      return;
    }

    const selectedTrial = trials[selectedIndex]?.trial;
    if (!selectedTrial) {
      p.log.error('Selected trial not found.');
      return;
    }

    p.note(
      formatTrialGraderDetails(selectedTrial),
      `Grader Results · ${selectedTrial.taskId} #${selectedTrial.trialIndex}`,
    );
  }
}
