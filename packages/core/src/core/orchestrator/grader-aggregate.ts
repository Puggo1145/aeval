import type { ExecutionResult } from '../contracts/execution.js';
import type { Graders } from '../contracts/runtime.js';
import type { TaskGraderStrategy } from '../contracts/task.js';
import type { GraderResult, TrialGraderResultRecord } from '../contracts/trial.js';
import type { GraderLayer } from '../domain/grader-layer.js';

export interface GraderAggregateResult {
  graderResults: TrialGraderResultRecord[];
  aggregate: {
    pass: boolean;
    score?: number;
  };
}

function computeAggregate(
  graderResults: TrialGraderResultRecord[],
  strategy: TaskGraderStrategy,
  passThreshold?: number,
): { pass: boolean; score?: number } {
  switch (strategy) {
    case 'ALL':
      return {
        pass: graderResults.every((grader) => grader.result.pass),
      };
    case 'ANY':
      return {
        pass: graderResults.some((grader) => grader.result.pass),
      };
    case 'WEIGHTED': {
      let totalWeight = 0;
      let weightedScore = 0;

      for (const grader of graderResults) {
        totalWeight += grader.weight ?? 0;
        const score = grader.result.score ?? (grader.result.pass ? 1 : 0);
        weightedScore += score * (grader.weight ?? 0);
      }

      const normalizedScore = weightedScore / totalWeight;
      return {
        pass: normalizedScore >= (passThreshold ?? 0),
        score: normalizedScore,
      };
    }
  }
}

export class GraderAggregator {
  constructor(private readonly graders: Graders) {}

  async grade(
    execution: ExecutionResult,
    layers: readonly GraderLayer[],
    strategy: TaskGraderStrategy,
    passThreshold?: number,
  ): Promise<GraderAggregateResult> {
    const graderResults: TrialGraderResultRecord[] = [];

    for (const layer of layers) {
      const grader = this.graders.require(layer.type);
      const result: GraderResult = await grader.grade(execution, layer);
      graderResults.push({
        name: layer.name,
        type: layer.type,
        result,
        ...(strategy === 'WEIGHTED' && layer.weight !== undefined ? { weight: layer.weight } : {}),
      });
    }

    return {
      graderResults,
      aggregate: computeAggregate(graderResults, strategy, passThreshold),
    };
  }
}
