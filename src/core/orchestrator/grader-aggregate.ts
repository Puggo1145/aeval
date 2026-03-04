import type { ExecutionResult } from '../contracts/execution.js';
import type { Grader } from '../contracts/runtime.js';
import type {
  TaskGraderLayer,
  TaskGraderStrategy,
  WeightedGraderLayer,
} from '../contracts/task.js';
import type { GraderResult, TrialGraderResult } from '../contracts/trial.js';
import { cloneAndDeepFreezeRecord } from './immutable-input.js';

export interface GraderAggregateInput {
  execution: ExecutionResult;
  layers: TaskGraderLayer[] | WeightedGraderLayer[];
  strategy: TaskGraderStrategy;
  passThreshold?: number;
  resolveGrader: (type: string) => Grader;
}

export interface GraderAggregateResult {
  graderResults: TrialGraderResult[];
  aggregate: {
    pass: boolean;
    score?: number;
  };
}

/**
 * Invariant: graderResults 不可能为空
 */
function computeAggregate(
  graderResults: TrialGraderResult[],
  strategy: TaskGraderStrategy,
  passThreshold?: number,
): { pass: boolean; score?: number } {
  switch (strategy) {
    // 全部 pass
    case 'ALL':
      return {
        pass: graderResults.every((g) => g.result.pass),
      };
    // 至少 pass 一个
    case 'ANY':
      return {
        pass: graderResults.some((g) => g.result.pass),
      };
    // 加权评分
    case 'WEIGHTED': {
      let totalWeight = 0;
      let weightedScore = 0;

      for (const g of graderResults) {
        totalWeight += g.weight!;
        // 优先使用显式 score，否则按 pass 映射成 1/0
        let score: number;
        if (g.result.score !== undefined) {
          // 如果 grader 显式给出了 score，则直接使用
          score = g.result.score;
        } else {
          // 如果没有 score，则根据 pass 信息来设定分数，pass 为 true 则 1.0，否则 0.0
          if (g.result.pass) {
            score = 1.0;
          } else {
            score = 0.0;
          }
        }
        weightedScore += score * g.weight!;
      }

      const normalizedScore = weightedScore / totalWeight;
      const threshold = passThreshold!;

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

  // 每一层走评分器
  for (const layer of input.layers) {
    const grader = input.resolveGrader(layer.type);
    const config = cloneAndDeepFreezeRecord(layer.config);
    const result: GraderResult = await grader(input.execution, config);

    const entry: TrialGraderResult = {
      name: layer.name,
      type: layer.type,
      result,
    };
    // 只有 WEIGHTED 策略需要 weight
    if (input.strategy === 'WEIGHTED') {
      entry.weight = (layer as WeightedGraderLayer).weight;
    }
    graderResults.push(entry);
  }

  const aggregate = computeAggregate(graderResults, input.strategy, input.passThreshold);

  return { graderResults, aggregate };
}
