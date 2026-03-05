import * as p from '@clack/prompts';

import type { CoreApi } from '../../../../core/api/index.js';
import type { BaselineThresholds } from '../../../../core/contracts/runtime.js';
import { readRunExperiments } from '../../run-metadata.js';
import { formatComparisonNote, formatRunOptionHint, formatRunOptionLabel } from '../formatters.js';
import { handleCancel } from '../utils.js';

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function compareBaseline(core: CoreApi): Promise<void> {
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
  const currentRunId = handleCancel(
    await p.select({
      message: 'Select the current run to compare:',
      options: records.map((r) => ({
        value: r.runId,
        label: formatRunOptionLabel(r),
        hint: formatRunOptionHint(experiments.get(r.runId)),
      })),
    }),
  );

  const useCustomBaseline = handleCancel(
    await p.confirm({
      message: 'Specify a custom baseline run? (No = use stored baseline)',
      initialValue: false,
    }),
  );

  let baselineRunId: string | undefined;
  if (useCustomBaseline) {
    const baselineOptions = records.filter((r) => r.runId !== currentRunId);
    if (baselineOptions.length === 0) {
      p.log.warn('No other runs available as baseline.');
      return;
    }

    baselineRunId = handleCancel(
      await p.select({
        message: 'Select the baseline run:',
        options: baselineOptions.map((r) => ({
          value: r.runId,
          label: formatRunOptionLabel(r),
          hint: formatRunOptionHint(experiments.get(r.runId)),
        })),
      }),
    );
  }

  const configureThresholds = handleCancel(
    await p.confirm({
      message: 'Configure regression thresholds?',
      initialValue: false,
    }),
  );

  let thresholds: BaselineThresholds | undefined;
  if (configureThresholds) {
    const passRateDropRaw = handleCancel(
      await p.text({
        message: 'Max pass rate drop (e.g. 0.05 for 5%, empty to skip):',
        placeholder: '',
      }),
    );

    const passHatKDropRaw = handleCancel(
      await p.text({
        message: 'Max pass^K drop (e.g. 0.05 for 5%, empty to skip):',
        placeholder: '',
      }),
    );

    const avgLatencyIncreaseRaw = handleCancel(
      await p.text({
        message: 'Max avg latency increase in ms (e.g. 500, empty to skip):',
        placeholder: '',
      }),
    );

    const passRateDrop = parseOptionalNumber(passRateDropRaw);
    const passHatKDrop = parseOptionalNumber(passHatKDropRaw);
    const avgLatencyIncrease = parseOptionalNumber(avgLatencyIncreaseRaw);

    if (
      passRateDrop !== undefined ||
      passHatKDrop !== undefined ||
      avgLatencyIncrease !== undefined
    ) {
      thresholds = { passRateDrop, passHatKDrop, avgLatencyIncrease };
    }
  }

  const comparison = await core.compareBaseline(currentRunId, {
    baselineRunId,
    thresholds,
  });

  formatComparisonNote(comparison);
}
