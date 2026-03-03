import * as p from '@clack/prompts';

import type { CoreApi } from '../../../../core/api/index.js';
import { formatSummaryNote } from '../formatters.js';
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

  const runId = handleCancel(
    await p.select({
      message: 'Select a run to view:',
      options: records.map((r) => ({
        value: r.runId,
        label: `${r.summary.runName} (${r.runId})`,
      })),
    }),
  );

  const summary = await core.getRunSummary(runId);
  if (!summary) {
    p.log.error(`Run '${runId}' not found.`);
    return;
  }

  formatSummaryNote(summary);
}
