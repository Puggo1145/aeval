import type { RunRecord } from '../../index.js';

import type { RunMetadata } from './run-metadata.js';

export interface RunTaskGroup {
  task: string;
  runs: RunRecord[];
}

export interface RunSuiteGroup {
  suite: string;
  tasks: RunTaskGroup[];
}

function formatGroupValue(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return 'unknown';
  }

  return value.trim();
}

export function groupRunsBySuiteAndTask(
  records: RunRecord[],
  metadataByRunId: ReadonlyMap<string, RunMetadata>,
): RunSuiteGroup[] {
  const suites = new Map<string, Map<string, RunRecord[]>>();

  for (const record of records) {
    const metadata = metadataByRunId.get(record.runId);
    const suite = formatGroupValue(metadata?.suiteName);
    const task =
      metadata?.taskId && metadata.taskId.trim().length > 0
        ? formatGroupValue(metadata.taskId)
        : formatGroupValue(record.summary?.taskId ?? record.manifest?.taskId);
    const tasks = suites.get(suite) ?? new Map<string, RunRecord[]>();
    const runs = tasks.get(task) ?? [];
    runs.push(record);
    tasks.set(task, runs);
    suites.set(suite, tasks);
  }

  return [...suites.entries()].map(([suite, taskMap]) => ({
    suite,
    tasks: [...taskMap.entries()].map(([task, runs]) => ({
      task,
      runs,
    })),
  }));
}
