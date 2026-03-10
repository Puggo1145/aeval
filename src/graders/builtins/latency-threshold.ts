import { z } from 'zod';
import type { ExecutionResult, ExecutionResultData, GraderResult } from '../../index.js';
import { ConfiguredGrader } from '../base-grader.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';

const LatencyThresholdConfigSchema = z
  .object({
    maxMs: z.number().finite().positive(),
  })
  .strict();

type LatencyThresholdConfig = z.infer<typeof LatencyThresholdConfigSchema>;

/**
 * Latency-threshold grader — validates performance from metrics.latencyMs.
 *
 * Config:
 *   maxMs: number  — maximum allowed latency in milliseconds
 */
async function gradeLatencyThreshold(
  result: ExecutionResult | ExecutionResultData,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(LatencyThresholdConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: LatencyThresholdConfig = parsed.config;

  const latency = result.metrics?.latencyMs;
  if (latency === undefined) {
    return { pass: false, reason: 'metrics.latencyMs is not available.' };
  }

  const pass = latency <= parsedConfig.maxMs;
  return {
    pass,
    reason: pass
      ? `Latency ${latency}ms is within threshold ${parsedConfig.maxMs}ms.`
      : `Latency ${latency}ms exceeds threshold ${parsedConfig.maxMs}ms.`,
    meta: { latencyMs: latency, maxMs: parsedConfig.maxMs },
  };
}

export const latencyThreshold = new ConfiguredGrader({
  type: 'latency-threshold',
  grade: (result, layer) => gradeLatencyThreshold(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(LatencyThresholdConfigSchema, layer.config),
});
