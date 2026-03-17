import type {
  ExecutionResult,
  Grader,
  GraderLayer,
  GraderResult,
  GraderValidationResult,
} from '@youmindinc/youeval-core';

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
