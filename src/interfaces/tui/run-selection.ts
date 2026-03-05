import type { RunSummaryRecord } from '../../core/contracts/run-summary.js';

import { formatExperimentText } from './formatters.js';

export interface RunExperimentGroup {
  experiment: string;
  runs: RunSummaryRecord[];
}

export function groupRunsByExperiment(
  records: RunSummaryRecord[],
  experimentsByRunId: ReadonlyMap<string, string>,
): RunExperimentGroup[] {
  const groups = new Map<string, RunSummaryRecord[]>();

  for (const record of records) {
    const experiment = formatExperimentText(experimentsByRunId.get(record.runId));
    const existing = groups.get(experiment);
    if (existing) {
      existing.push(record);
      continue;
    }
    groups.set(experiment, [record]);
  }

  return [...groups.entries()].map(([experiment, runs]) => ({ experiment, runs }));
}
