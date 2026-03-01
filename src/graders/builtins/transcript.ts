import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

/**
 * Transcript grader — validates multi-turn behavior from trace.turns.
 *
 * Config:
 *   maxTurns?: number           — maximum number of turns
 *   minTurns?: number           — minimum number of turns
 *   mustStartWith?: 'user' | 'assistant'  — expected role of first turn
 *   mustEndWith?: 'user' | 'assistant'    — expected role of last turn
 *   maxConsecutiveSameRole?: number        — max consecutive turns with same role
 *
 * At least one config field must be provided.
 */
export async function transcript(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const { maxTurns, minTurns, mustStartWith, mustEndWith, maxConsecutiveSameRole } = config;

  if (
    maxTurns === undefined &&
    minTurns === undefined &&
    mustStartWith === undefined &&
    mustEndWith === undefined &&
    maxConsecutiveSameRole === undefined
  ) {
    return { pass: false, reason: 'Config must provide at least one transcript constraint.' };
  }

  const turns = result.trace?.turns ?? [];
  const failures: string[] = [];

  if (minTurns !== undefined && typeof minTurns === 'number') {
    if (turns.length < minTurns) {
      failures.push(`Turn count ${turns.length} is below minimum ${minTurns}.`);
    }
  }

  if (maxTurns !== undefined && typeof maxTurns === 'number') {
    if (turns.length > maxTurns) {
      failures.push(`Turn count ${turns.length} exceeds maximum ${maxTurns}.`);
    }
  }

  if (mustStartWith !== undefined && typeof mustStartWith === 'string') {
    const first = turns[0];
    if (first && first.role !== mustStartWith) {
      failures.push(`First turn role is '${first.role}', expected '${mustStartWith}'.`);
    }
  }

  if (mustEndWith !== undefined && typeof mustEndWith === 'string') {
    const last = turns.at(-1);
    if (last && last.role !== mustEndWith) {
      failures.push(`Last turn role is '${last.role}', expected '${mustEndWith}'.`);
    }
  }

  if (maxConsecutiveSameRole !== undefined && typeof maxConsecutiveSameRole === 'number') {
    let consecutive = 1;
    for (let i = 1; i < turns.length; i++) {
      const current = turns[i]!;
      const prev = turns[i - 1]!;
      if (current.role === prev.role) {
        consecutive++;
        if (consecutive > maxConsecutiveSameRole) {
          failures.push(
            `Found ${consecutive} consecutive '${current.role}' turns, max allowed is ${maxConsecutiveSameRole}.`,
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
