import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

/**
 * Latency-threshold grader — validates performance from metrics.latencyMs.
 *
 * Config:
 *   maxMs: number  — maximum allowed latency in milliseconds
 */
export async function latencyThreshold(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const maxMs = config.maxMs;
  if (typeof maxMs !== 'number' || !Number.isFinite(maxMs) || maxMs <= 0) {
    return { pass: false, reason: "Config 'maxMs' must be a finite positive number." };
  }

  const latency = result.metrics?.latencyMs;
  if (latency === undefined) {
    return { pass: false, reason: 'metrics.latencyMs is not available.' };
  }

  const pass = latency <= maxMs;
  return {
    pass,
    reason: pass
      ? `Latency ${latency}ms is within threshold ${maxMs}ms.`
      : `Latency ${latency}ms exceeds threshold ${maxMs}ms.`,
    meta: { latencyMs: latency, maxMs },
  };
}
