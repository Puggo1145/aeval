import { createHash } from 'node:crypto';

import type { ExperimentDefinition } from '../contracts/experiment.js';

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

/**
 * 按 §5.5 规则计算可复现的 configHash。
 *
 * 参与字段（序列化前按 key 排序）：
 *   - experiment.schemaVersion
 *   - experiment.taskSource.adapter
 *   - experiment.runs[]（每个 RunConfig 的 name + overrides）
 *   - experiment.trialsPerTask
 *   - experiment.maxConcurrency
 *   - experiment.timeoutMs
 *   - experiment.resultStore.adapter
 *
 * 排除字段：
 *   - experiment.name
 *   - experiment.observers
 */
export function computeConfigHash(experiment: ExperimentDefinition): string {
  const hashInput = {
    maxConcurrency: experiment.maxConcurrency,
    resultStoreAdapter: experiment.resultStore.adapter,
    runs: experiment.runs.map((run) => ({
      name: run.name,
      overrides: run.overrides,
    })),
    schemaVersion: experiment.schemaVersion,
    taskSourceAdapter: experiment.taskSource.adapter,
    timeoutMs: experiment.timeoutMs,
    trialsPerTask: experiment.trialsPerTask,
  };

  const serialized = JSON.stringify(toCanonicalJsonValue(hashInput));
  return createHash('sha256').update(serialized).digest('hex');
}

function toCanonicalJsonValue(value: unknown): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalJsonValue(item));
  }

  if (typeof value === 'object') {
    const normalized: { [key: string]: CanonicalJsonValue } = {};
    const record = value as Record<string, unknown>;

    for (const key of Object.keys(record).sort()) {
      const fieldValue = record[key];
      if (fieldValue === undefined) {
        continue;
      }
      normalized[key] = toCanonicalJsonValue(fieldValue);
    }

    return normalized;
  }

  throw new TypeError(`Unsupported value type in config hash payload: ${typeof value}`);
}
