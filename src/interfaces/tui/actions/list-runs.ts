import * as p from '@clack/prompts';

import type { CoreApi } from '../../../index.js';
import { formatRunsTable } from '../formatters.js';
import { readRunMetadataMap } from '../run-metadata.js';

export async function listRuns(core: CoreApi): Promise<void> {
  const s = p.spinner();
  s.start('Loading runs…');

  const records = await core.results.list();
  const metadata = await readRunMetadataMap(
    core,
    records.map((record) => record.runId),
  );

  s.stop('Runs loaded.');

  p.note(formatRunsTable(records, metadata), 'All Runs');
}
