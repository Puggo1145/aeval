import * as p from '@clack/prompts';

import type { CoreApi } from '../../../../core/api/index.js';
import { readRunExperiments } from '../../run-metadata.js';
import { formatRunOptionHint, formatRunOptionLabel } from '../formatters.js';
import { handleCancel } from '../utils.js';

export async function setBaseline(core: CoreApi): Promise<void> {
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
  const runId = handleCancel(
    await p.select({
      message: 'Select a run to set as baseline:',
      options: records.map((r) => ({
        value: r.runId,
        label: formatRunOptionLabel(r),
        hint: formatRunOptionHint(experiments.get(r.runId)),
      })),
    }),
  );

  await core.setBaseline(runId);
  p.log.success(`Baseline set to run '${runId}'.`);
}
