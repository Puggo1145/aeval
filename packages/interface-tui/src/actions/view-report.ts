import type { CoreApi } from '@aeval/core';
import * as p from '@clack/prompts';
import {
  formatManifestOnlyRunNote,
  formatRunOptionLabel,
  formatRunOptionStatsHint,
  formatSummaryNote,
} from '../formatters.js';
import { readRunMetadataMap } from '../run-metadata.js';
import { groupRunsBySuiteAndTask } from '../run-selection.js';
import { handleCancel } from '../utils.js';

export async function viewReport(core: CoreApi): Promise<void> {
  const s = p.spinner();
  s.start('Loading runs…');
  const records = await core.results.list();
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
      message: 'Select a run to view:',
      options: runsForTask.map((r) => ({
        value: r.runId,
        label: formatRunOptionLabel(r),
        hint: formatRunOptionStatsHint(r),
      })),
    }),
  );

  const record = runsForTask.find((candidate) => candidate.runId === runId);
  if (!record) {
    p.log.error(`Run '${runId}' not found in run list.`);
    return;
  }

  if (record.summary) {
    const trials = await core.results.listTrials(runId);
    formatSummaryNote(record.summary, metadataByRunId.get(runId), trials);
    return;
  }

  formatManifestOnlyRunNote(record, metadataByRunId.get(runId));
}
