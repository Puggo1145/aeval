import type { BaselineComparison, BaselineThresholds } from '../contracts/runtime.js';
import { ValidationError } from '../errors/index.js';

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
  if (hasMetricImprovement) {
    return 'improved';
  }

  return 'pass';
}
