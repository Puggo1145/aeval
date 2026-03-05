import * as p from '@clack/prompts';

import type { CoreApi } from '../../../core/api/index.js';
import { readRunExperiments } from '../run-metadata.js';
import { formatRunsTable } from '../formatters.js';

export async function listRuns(core: CoreApi): Promise<void> {
  const s = p.spinner();
  s.start('Loading runs…');

  const records = await core.listRuns();
  const experiments = await readRunExperiments(
    core,
    records.map((record) => record.runId),
  );

  s.stop('Runs loaded.');

  p.note(formatRunsTable(records, experiments), 'All Runs');
}
