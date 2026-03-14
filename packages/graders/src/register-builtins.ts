import type { Graders } from '@youeval/core';
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
 * Registers all built-in graders into the given registry.
 *
 * Built-in graders registered:
 *   exact-match, contains, regex, json-schema, length-check,
 *   tool-calls, transcript, outcome-check, latency-threshold, token-budget
 *
 * Note: `llm-judge` is registered explicitly by the caller so the judge
 * provider wiring stays opt-in. `custom` graders are also registered
 * directly via `graders.register(...)`.
 */
export function registerBuiltinGraders(graders: Graders): void {
  graders.register(exactMatch);
  graders.register(contains);
  graders.register(regex);
  graders.register(jsonSchema);
  graders.register(lengthCheck);
  graders.register(toolCalls);
  graders.register(transcript);
  graders.register(outcomeCheck);
  graders.register(latencyThreshold);
  graders.register(tokenBudget);
}
