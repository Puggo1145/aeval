import * as p from '@clack/prompts';

import type { CoreApi } from '../../../../core/api/index.js';
import { readRunExperiments } from '../../run-metadata.js';
import {
  formatRunOptionLabel,
  formatRunOptionStatsHint,
  formatSummaryNote,
} from '../formatters.js';
import { groupRunsByExperiment } from '../run-selection.js';
import { handleCancel } from '../utils.js';

export async function viewReport(core: CoreApi): Promise<void> {
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
      message: 'Select a run to view:',
      options: runsInExperiment.map((r) => ({
        value: r.runId,
        label: formatRunOptionLabel(r),
        hint: formatRunOptionStatsHint(r),
      })),
    }),
  );

  const summary = await core.getRunSummary(runId);
  if (!summary) {
    p.log.error(`Run '${runId}' not found.`);
    return;
  }

  formatSummaryNote(summary, experiments.get(runId));
}
