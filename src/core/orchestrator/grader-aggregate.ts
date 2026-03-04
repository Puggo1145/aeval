import type { ExecutionResult } from '../contracts/execution.js';
import type { Grader } from '../contracts/runtime.js';
import type { TaskGraderLayer, TaskGraderStrategy } from '../contracts/task.js';
import type { GraderResult, TrialGraderResult } from '../contracts/trial.js';
import { cloneAndDeepFreezeRecord } from './immutable-input.js';

export interface GraderAggregateInput {
  execution: ExecutionResult;
  layers: TaskGraderLayer[];
  strategy: TaskGraderStrategy;
  passThreshold?: number | null;
  resolveGrader: (type: string) => Grader;
}

export interface GraderAggregateResult {
  graderResults: TrialGraderResult[];
  aggregate: {
    pass: boolean;
    score?: number;
  };
}

function computeAggregate(
  graderResults: TrialGraderResult[],
  strategy: TaskGraderStrategy,
  passThreshold?: number | null,
): { pass: boolean; score?: number } {
  if (graderResults.length === 0) {
    return { pass: true };
  }

  switch (strategy) {
    case 'ALL':
      return {
        pass: graderResults.every((g) => g.result.pass),
      };
    case 'ANY':
      return {
        pass: graderResults.some((g) => g.result.pass),
      };
    case 'WEIGHTED': {
      let totalWeight = 0;
      let weightedScore = 0;

      for (const g of graderResults) {
        totalWeight += g.weight;
        // 优先使用显式 score，否则按 pass 映射成 1/0
        const score = g.result.score !== undefined ? g.result.score : g.result.pass ? 1.0 : 0.0;
        weightedScore += score * g.weight;
      }

      const normalizedScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
      const threshold = passThreshold ?? 0;

      return {
        pass: normalizedScore >= threshold,
        score: normalizedScore,
      };
    }
  }
}

/**
 * 执行所有 grader layer，并按配置策略聚合最终 pass/score。
 */
export async function aggregateGraders(
  input: GraderAggregateInput,
): Promise<GraderAggregateResult> {
  const graderResults: TrialGraderResult[] = [];

  for (const layer of input.layers) {
    const grader = input.resolveGrader(layer.type);
    const config = cloneAndDeepFreezeRecord(layer.config);
    const result: GraderResult = await grader(input.execution, config);

    graderResults.push({
      name: layer.name,
      type: layer.type,
      result,
      weight: layer.weight ?? 1.0,
    });
  }

  const aggregate = computeAggregate(graderResults, input.strategy, input.passThreshold);

  return { graderResults, aggregate };
}
