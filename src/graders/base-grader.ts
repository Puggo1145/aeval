import type { Grader, GraderValidationResult } from '../core/contracts/runtime.js';
import type { GraderResult } from '../core/contracts/trial.js';
import type { ExecutionResult } from '../core/domain/execution-result.js';
import type { GraderLayer } from '../core/domain/grader-layer.js';

export interface ConfiguredGraderOptions {
  type: string;
  grade: (result: ExecutionResult, layer: GraderLayer) => Promise<GraderResult>;
  validate?: (layer: GraderLayer) => GraderValidationResult;
}

export class ConfiguredGrader implements Grader {
  readonly type: string;

  private readonly gradeFn: ConfiguredGraderOptions['grade'];
  private readonly validateFn?: ConfiguredGraderOptions['validate'];

  constructor(options: ConfiguredGraderOptions) {
    this.type = options.type;
    this.gradeFn = options.grade;
    this.validateFn = options.validate;
  }

  async grade(result: ExecutionResult, layer: GraderLayer): Promise<GraderResult> {
    return this.gradeFn(result, layer);
  }

  validate(layer: GraderLayer): GraderValidationResult {
    return this.validateFn?.(layer) ?? { valid: true };
  }
}
