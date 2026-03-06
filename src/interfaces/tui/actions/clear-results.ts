import * as p from '@clack/prompts';

import type { CoreApi } from '../../../core/api/index.js';
import { formatRunOptionHint, formatRunOptionLabel } from '../formatters.js';
import { readRunMetadataMap } from '../run-metadata.js';
import { handleCancel } from '../utils.js';

const SECOND_CONFIRM_TOKEN = 'DELETE';
type ClearMode = 'selected' | 'all';

function renderDeletedEntries(entries: Awaited<ReturnType<CoreApi['clearResults']>>): void {
  if (entries.length === 0) {
    p.log.info('No result files found.');
    return;
  }

  const deletedLines = entries.map((entry) => {
    const prefix = entry.kind === 'dir' ? '[DIR ]' : '[FILE]';
    return `${prefix} ${entry.path}`;
  });
  p.note(deletedLines.join('\n'), 'Deleted Contents');
  p.log.success(`Deleted ${entries.length} item(s).`);
}

export async function clearResults(core: CoreApi, mode: ClearMode): Promise<void> {
  const records = await core.listRuns();
  const runCount = records.length;
  if (runCount === 0) {
    p.log.info('No runs found. Nothing to clear.');
    return;
  }

  const metadataByRunId = await readRunMetadataMap(
    core,
    records.map((record) => record.runId),
  );
  const runLabels = records.map((record) => ({
    runId: record.runId,
    label: formatRunOptionLabel(record),
    hint: formatRunOptionHint(metadataByRunId.get(record.runId)),
  }));

  if (mode === 'all') {
    p.note(
      runLabels.map((record) => `${record.label}  [${record.hint}]`).join('\n'),
      'Runs To Be Deleted',
    );

    const confirmed = handleCancel(
      await p.confirm({
        message: `Delete all results? This removes ${runCount} run(s), trial data, and baseline metadata.`,
        initialValue: false,
      }),
    );
    if (!confirmed) {
      p.log.info('Clear results cancelled.');
      return;
    }

    const secondConfirmation = handleCancel(
      await p.text({
        message: `Type '${SECOND_CONFIRM_TOKEN}' to confirm permanent deletion:`,
        placeholder: SECOND_CONFIRM_TOKEN,
      }),
    );

    if (secondConfirmation.trim() !== SECOND_CONFIRM_TOKEN) {
      p.log.warn('Confirmation text mismatch. No files were deleted.');
      return;
    }

    const s = p.spinner();
    s.start('Deleting all results...');
    const deletedEntries = await core.clearResults();
    s.stop('Results deleted.');
    renderDeletedEntries(deletedEntries);
    return;
  }

  const selectedRunIds = handleCancel(
    await p.multiselect<string>({
      message: 'Select result runs to delete:',
      options: runLabels.map((record) => ({
        value: record.runId,
        label: record.label,
        hint: record.hint,
      })),
      required: true,
    }),
  );

  const selectedLabels = runLabels
    .filter((record) => selectedRunIds.includes(record.runId))
    .map((record) => `${record.label}  [${record.hint}]`);
  p.note(selectedLabels.join('\n'), 'Selected Runs');

  const confirmed = handleCancel(
    await p.confirm({
      message: `Delete selected results (${selectedRunIds.length} run(s))?`,
      initialValue: false,
    }),
  );
  if (!confirmed) {
    p.log.info('Clear selected results cancelled.');
    return;
  }

  const secondConfirmation = handleCancel(
    await p.text({
      message: `Type '${SECOND_CONFIRM_TOKEN}' to confirm permanent deletion:`,
      placeholder: SECOND_CONFIRM_TOKEN,
    }),
  );

  if (secondConfirmation.trim() !== SECOND_CONFIRM_TOKEN) {
    p.log.warn('Confirmation text mismatch. No files were deleted.');
    return;
  }

  const s = p.spinner();
  s.start('Deleting selected results...');
  const deletedEntries = await core.clearResultsByRunIds(selectedRunIds);
  s.stop('Selected results deleted.');
  renderDeletedEntries(deletedEntries);
}
