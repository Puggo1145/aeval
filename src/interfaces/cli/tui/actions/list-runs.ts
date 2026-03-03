import * as p from '@clack/prompts';

import type { CoreApi } from '../../../../core/api/index.js';
import { formatRunsTable } from '../formatters.js';

export async function listRuns(core: CoreApi): Promise<void> {
  const s = p.spinner();
  s.start('Loading runs…');

  const records = await core.listRuns();

  s.stop('Runs loaded.');

  p.note(formatRunsTable(records), 'All Runs');
}
