import type { Grader, Graders } from '@aeval/core';
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

/**
 * All built-in graders that need no extra runtime wiring:
 *   exact-match, contains, regex, json-schema, length-check,
 *   tool-calls, transcript, outcome-check, latency-threshold, token-budget
 *
 * `llm-judge` is excluded so judge provider wiring stays opt-in; register it
 * explicitly via `new BuiltinLlmJudgeGrader(...)` or `new LlmJudgeGrader(...)`.
 *
 * Compose directly: `new Core({ graders: [...builtinGraders], ... })`.
 */
export const builtinGraders: readonly Grader[] = Object.freeze([
  exactMatch,
  contains,
  regex,
  jsonSchema,
  lengthCheck,
  toolCalls,
  transcript,
  outcomeCheck,
  latencyThreshold,
  tokenBudget,
]);

/** Registers all built-in graders into an existing registry. */
export function registerBuiltinGraders(graders: Graders): void {
  for (const grader of builtinGraders) {
    graders.register(grader);
  }
}
