import * as p from '@clack/prompts';

import type { CoreApi } from '../../../core/api/index.js';
import {
  formatRunOptionLabel,
  formatRunOptionStatsHint,
  formatTrialGraderDetails,
  formatTrialsTable,
} from '../formatters.js';
import { readRunMetadataMap } from '../run-metadata.js';
import { groupRunsBySuiteAndTask } from '../run-selection.js';
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

  const metadataByRunId = await readRunMetadataMap(
    core,
    records.map((record) => record.runId),
  );
  const suiteGroups = groupRunsBySuiteAndTask(records, metadataByRunId);
  const selectedSuite = handleCancel(
    await p.select({
      message: 'Select a suite:',
      options: suiteGroups.map((group) => ({
        value: group.suite,
        label: group.suite,
        hint: `${group.tasks.length} task${group.tasks.length === 1 ? '' : 's'}`,
      })),
    }),
  );
  const selectedTaskGroup = suiteGroups.find((group) => group.suite === selectedSuite);
  if (!selectedTaskGroup) {
    p.log.warn(`No runs found under suite '${selectedSuite}'.`);
    return;
  }

  const selectedTask = handleCancel(
    await p.select({
      message: 'Select a task:',
      options: selectedTaskGroup.tasks.map((group) => ({
        value: group.task,
        label: group.task,
        hint: `${group.runs.length} run${group.runs.length === 1 ? '' : 's'}`,
      })),
    }),
  );
  const runsForTask =
    selectedTaskGroup.tasks.find((group) => group.task === selectedTask)?.runs ?? [];
  if (runsForTask.length === 0) {
    p.log.warn(`No runs found under task '${selectedTask}'.`);
    return;
  }

  const runId = handleCancel(
    await p.select({
      message: 'Select a run to view trials:',
      options: runsForTask.map((r) => ({
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
