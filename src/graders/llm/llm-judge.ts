import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { Grader } from '../../core/contracts/runtime.js';
import type { GraderResult } from '../../core/contracts/trial.js';
import type { JudgeProvider } from './judge-provider.js';

/**
 * Resolves a dot-separated path against the ExecutionResult to extract context.
 * e.g., "outcome.boardContent" → result.outcome?.boardContent
 */
function resolveContextPath(result: ExecutionResult, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = result;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Creates an llm-judge grader bound to a specific JudgeProvider.
 *
 * Config (from Task DSL):
 *   dimension: string         — evaluation dimension (e.g., "faithfulness")
 *   rubric: string            — evaluation rubric text
 *   contextFrom?: string      — dot-path into ExecutionResult for context (e.g., "outcome.boardContent")
 *   model?: string            — hint for which judge model to use (passed through to provider)
 */
export function createLlmJudgeGrader(judgeProvider: JudgeProvider): Grader {
  return async (
    result: ExecutionResult,
    config: Record<string, unknown>,
  ): Promise<GraderResult> => {
    const dimension = config.dimension;
    const rubric = config.rubric;

    if (typeof dimension !== 'string' || dimension.trim().length === 0) {
      return { pass: false, reason: "Config 'dimension' must be a non-empty string." };
    }

    if (typeof rubric !== 'string' || rubric.trim().length === 0) {
      return { pass: false, reason: "Config 'rubric' must be a non-empty string." };
    }

    // Resolve optional context from ExecutionResult
    let context: unknown;
    if (typeof config.contextFrom === 'string') {
      context = resolveContextPath(result, config.contextFrom);
    }

    const judgeResult = await judgeProvider.evaluate({
      output: result.output,
      rubric,
      context,
      dimension,
    });

    return {
      pass: judgeResult.pass,
      score: judgeResult.score,
      reason: judgeResult.reason,
      meta: {
        label: judgeResult.label,
        dimension,
        model: config.model,
      },
    };
  };
}
