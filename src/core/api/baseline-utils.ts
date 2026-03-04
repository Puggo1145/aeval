import type { BaselineComparison, BaselineThresholds } from '../contracts/runtime.js';
import type { TrialResultRecord } from '../contracts/trial.js';
import { ValidationError } from '../errors/index.js';

function buildTaskPassIndex(trials: TrialResultRecord[]): Map<string, boolean> {
  const index = new Map<string, boolean>();

  for (const record of trials) {
    const current = index.get(record.trial.taskId) ?? false;
    index.set(record.trial.taskId, current || record.trial.aggregate.pass);
  }

  return index;
}

export function computeRegressionDiff(
  baselineTrials: TrialResultRecord[],
  currentTrials: TrialResultRecord[],
): { regressions: string[]; improvements: string[] } {
  const baselinePassIndex = buildTaskPassIndex(baselineTrials);
  const currentPassIndex = buildTaskPassIndex(currentTrials);
  const allTaskIds = new Set<string>([...baselinePassIndex.keys(), ...currentPassIndex.keys()]);

  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const taskId of allTaskIds) {
    const baselinePass = baselinePassIndex.get(taskId) ?? false;
    const currentPass = currentPassIndex.get(taskId) ?? false;

    if (baselinePass && !currentPass) {
      regressions.push(taskId);
      continue;
    }

    if (!baselinePass && currentPass) {
      improvements.push(taskId);
    }
  }

  regressions.sort();
  improvements.sort();

  return { regressions, improvements };
}

export function validateComparableDelta(
  threshold: number | undefined,
  delta: number | undefined,
  field: string,
): void {
  if (threshold === undefined) {
    return;
  }

  if (delta !== undefined) {
    return;
  }

  throw new ValidationError(`Field '${field}' is required when a threshold is provided.`, {
    details: {
      field,
      threshold,
    },
  });
}

function validateNonNegativeFiniteThreshold(
  value: number | undefined,
  field: keyof BaselineThresholds,
): void {
  if (value === undefined) {
    return;
  }

  if (Number.isFinite(value) && value >= 0) {
    return;
  }

  throw new ValidationError(`Field 'thresholds.${field}' must be a non-negative finite number.`, {
    details: {
      field: `thresholds.${field}`,
      value,
    },
  });
}

export function validateBaselineThresholds(thresholds: BaselineThresholds | undefined): void {
  if (!thresholds) {
    return;
  }

  validateNonNegativeFiniteThreshold(thresholds.passRateDrop, 'passRateDrop');
  validateNonNegativeFiniteThreshold(thresholds.passHatKDrop, 'passHatKDrop');
  validateNonNegativeFiniteThreshold(thresholds.avgLatencyIncrease, 'avgLatencyIncrease');
}

export function computeVerdict(
  comparison: {
    passRateDelta: number;
    passHatKDelta?: number;
    avgLatencyDelta?: number;
    tokenBudgetBreached?: boolean;
    improvements: string[];
  },
  thresholds: BaselineThresholds | undefined,
): BaselineComparison['verdict'] {
  // Regression checks are threshold-driven so defaults stay permissive.
  const passRateRegressed =
    thresholds?.passRateDrop !== undefined && comparison.passRateDelta < -thresholds.passRateDrop;
  const passHatKRegressed =
    thresholds?.passHatKDrop !== undefined &&
    comparison.passHatKDelta !== undefined &&
    comparison.passHatKDelta < -thresholds.passHatKDrop;
  const latencyRegressed =
    thresholds?.avgLatencyIncrease !== undefined &&
    comparison.avgLatencyDelta !== undefined &&
    comparison.avgLatencyDelta > thresholds.avgLatencyIncrease;
  const tokenBudgetRegressed = comparison.tokenBudgetBreached === true;

  if (passRateRegressed || passHatKRegressed || latencyRegressed || tokenBudgetRegressed) {
    return 'regressed';
  }

  // Improvement can come from metrics or task-level diff.
  const hasMetricImprovement =
    comparison.passRateDelta > 0 ||
    (comparison.passHatKDelta !== undefined && comparison.passHatKDelta > 0) ||
    (comparison.avgLatencyDelta !== undefined && comparison.avgLatencyDelta < 0);
  if (hasMetricImprovement || comparison.improvements.length > 0) {
    return 'improved';
  }

  return 'pass';
}
