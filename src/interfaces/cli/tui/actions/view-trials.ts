import * as p from '@clack/prompts';

import type { CoreApi } from '../../../../core/api/index.js';
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

  const runId = handleCancel(
    await p.select({
      message: 'Select a run to view trials:',
      options: records.map((r) => ({
        value: r.runId,
        label: `${r.summary.runName} (${r.runId})`,
      })),
    }),
  );

  const trials = await core.listTrials(runId);

  if (trials.length === 0) {
    p.log.warn(`No trials found for run '${runId}'.`);
    return;
  }

  const lines = trials.map((record) => {
    const t = record.trial;
    const score = t.aggregate.score !== undefined ? t.aggregate.score.toFixed(2) : '-';
    const status = t.aggregate.pass ? 'PASS' : 'FAIL';
    return `${t.taskId} #${t.trialIndex}  ${status}  score=${score}  ${t.timings.durationMs}ms`;
  });

  p.note(lines.join('\n'), 'Trials');
}
