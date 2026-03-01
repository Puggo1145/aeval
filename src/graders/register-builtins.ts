import type { GraderRegistry } from '../core/contracts/runtime.js';
import { contains } from './builtins/contains.js';
import { exactMatch } from './builtins/exact-match.js';
import { jsonSchema } from './builtins/json-schema.js';
import { latencyThreshold } from './builtins/latency-threshold.js';
import { lengthCheck } from './builtins/length-check.js';
import { outcomeCheck } from './builtins/outcome-check.js';
import { regex } from './builtins/regex.js';
import { tokenBudget } from './builtins/token-budget.js';
import { toolCalls } from './builtins/tool-calls.js';
import { transcript } from './builtins/transcript.js';
import type { JudgeProvider } from './llm/judge-provider.js';
import { createLlmJudgeGrader } from './llm/llm-judge.js';

export interface RegisterBuiltinGradersOptions {
  /** Optional JudgeProvider for the llm-judge grader. If omitted, llm-judge is not registered. */
  judgeProvider?: JudgeProvider;
}

/**
 * Registers all built-in graders into the given registry.
 *
 * Built-in graders registered:
 *   exact-match, contains, regex, json-schema, length-check,
 *   tool-calls, transcript, outcome-check, latency-threshold, token-budget
 *
 * Optional:
 *   llm-judge — registered only when a JudgeProvider is supplied
 *
 * Note: `custom` graders are not auto-registered; users register them
 * via `graderRegistry.register('custom', fn)` or any custom type name.
 */
export function registerBuiltinGraders(
  registry: GraderRegistry,
  options: RegisterBuiltinGradersOptions = {},
): void {
  registry.register('exact-match', exactMatch);
  registry.register('contains', contains);
  registry.register('regex', regex);
  registry.register('json-schema', jsonSchema);
  registry.register('length-check', lengthCheck);
  registry.register('tool-calls', toolCalls);
  registry.register('transcript', transcript);
  registry.register('outcome-check', outcomeCheck);
  registry.register('latency-threshold', latencyThreshold);
  registry.register('token-budget', tokenBudget);

  if (options.judgeProvider) {
    registry.register('llm-judge', createLlmJudgeGrader(options.judgeProvider));
  }
}
