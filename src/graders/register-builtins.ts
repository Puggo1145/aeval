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

/**
 * Registers all built-in graders into the given registry.
 *
 * Built-in graders registered:
 *   exact-match, contains, regex, json-schema, length-check,
 *   tool-calls, transcript, outcome-check, latency-threshold, token-budget
 *
 * Note: `llm-judge` is registered explicitly by the caller so the judge
 * provider wiring stays opt-in. `custom` graders are also registered
 * directly via `graderRegistry.register(...)`.
 */
export function registerBuiltinGraders(registry: GraderRegistry): void {
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
}
