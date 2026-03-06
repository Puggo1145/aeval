import * as p from '@clack/prompts';

import type { CoreApi } from '../../../core/api/index.js';
import { formatRunOptionHint, formatRunOptionLabel } from '../formatters.js';
import { readRunMetadataMap } from '../run-metadata.js';
import { handleCancel } from '../utils.js';

export async function setBaseline(core: CoreApi): Promise<void> {
  const s = p.spinner();
  s.start('Loading runs…');
  const records = await core.listRuns();
  const completedRuns = records.filter((record) => record.status === 'completed');
  s.stop('Runs loaded.');

  if (completedRuns.length === 0) {
    p.log.warn('No completed runs found.');
    return;
  }

  const metadataByRunId = await readRunMetadataMap(
    core,
    completedRuns.map((record) => record.runId),
  );
  const runId = handleCancel(
    await p.select({
      message: 'Select a run to set as baseline:',
      options: completedRuns.map((r) => ({
        value: r.runId,
        label: formatRunOptionLabel(r),
        hint: formatRunOptionHint(metadataByRunId.get(r.runId)),
      })),
    }),
  );

  await core.setBaseline(runId);
  p.log.success(`Baseline set to run '${runId}'.`);
}
