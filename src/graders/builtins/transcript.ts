import { z } from 'zod';
import type { ExecutionResult, ExecutionResultData, GraderResult } from '../../index.js';
import { ConfiguredGrader } from '../base-grader.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';

const TranscriptConfigSchema = z
  .object({
    maxTurns: z.number().int().finite().nonnegative().optional(),
    minTurns: z.number().int().finite().nonnegative().optional(),
    mustStartWith: z.enum(['system', 'user', 'assistant']).optional(),
    mustEndWith: z.enum(['system', 'user', 'assistant']).optional(),
    maxConsecutiveSameRole: z.number().int().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAnyConstraint =
      value.maxTurns !== undefined ||
      value.minTurns !== undefined ||
      value.mustStartWith !== undefined ||
      value.mustEndWith !== undefined ||
      value.maxConsecutiveSameRole !== undefined;
    if (!hasAnyConstraint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Config must provide at least one transcript constraint.',
      });
    }

    if (
      value.minTurns !== undefined &&
      value.maxTurns !== undefined &&
      value.minTurns > value.maxTurns
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minTurns'],
        message: "Field 'minTurns' must be less than or equal to 'maxTurns'.",
      });
    }
  });

type TranscriptConfig = z.infer<typeof TranscriptConfigSchema>;

/**
 * Transcript grader — validates multi-turn behavior from trace.turns.
 *
 * Config:
 *   maxTurns?: number           — maximum number of turns
 *   minTurns?: number           — minimum number of turns
 *   mustStartWith?: 'system' | 'user' | 'assistant'  — expected role of first turn
 *   mustEndWith?: 'system' | 'user' | 'assistant'    — expected role of last turn
 *   maxConsecutiveSameRole?: number        — max consecutive turns with same role
 *
 * At least one config field must be provided.
 */
async function gradeTranscript(
  result: ExecutionResult | ExecutionResultData,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(TranscriptConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: TranscriptConfig = parsed.config;

  const turns = result.trace?.turns ?? [];
  const failures: string[] = [];

  if (parsedConfig.minTurns !== undefined) {
    if (turns.length < parsedConfig.minTurns) {
      failures.push(`Turn count ${turns.length} is below minimum ${parsedConfig.minTurns}.`);
    }
  }

  if (parsedConfig.maxTurns !== undefined) {
    if (turns.length > parsedConfig.maxTurns) {
      failures.push(`Turn count ${turns.length} exceeds maximum ${parsedConfig.maxTurns}.`);
    }
  }

  if (parsedConfig.mustStartWith !== undefined) {
    const first = turns[0];
    if (!first) {
      failures.push(
        `First turn is missing, expected first turn role '${parsedConfig.mustStartWith}'.`,
      );
    } else if (first.role !== parsedConfig.mustStartWith) {
      failures.push(
        `First turn role is '${first.role}', expected '${parsedConfig.mustStartWith}'.`,
      );
    }
  }

  if (parsedConfig.mustEndWith !== undefined) {
    const last = turns.at(-1);
    if (!last) {
      failures.push(`Last turn is missing, expected last turn role '${parsedConfig.mustEndWith}'.`);
    } else if (last.role !== parsedConfig.mustEndWith) {
      failures.push(`Last turn role is '${last.role}', expected '${parsedConfig.mustEndWith}'.`);
    }
  }

  if (parsedConfig.maxConsecutiveSameRole !== undefined) {
    let consecutive = 1;
    for (let i = 1; i < turns.length; i++) {
      const current = turns[i]!;
      const prev = turns[i - 1]!;
      if (current.role === prev.role) {
        consecutive++;
        if (consecutive > parsedConfig.maxConsecutiveSameRole) {
          failures.push(
            `Found ${consecutive} consecutive '${current.role}' turns, max allowed is ${parsedConfig.maxConsecutiveSameRole}.`,
          );
          break;
        }
      } else {
        consecutive = 1;
      }
    }
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' ') };
  }

  return {
    pass: true,
    reason: 'All transcript checks passed.',
    meta: { turnCount: turns.length },
  };
}

export const transcript = new ConfiguredGrader({
  type: 'transcript',
  grade: (result, layer) => gradeTranscript(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(TranscriptConfigSchema, layer.config),
});
