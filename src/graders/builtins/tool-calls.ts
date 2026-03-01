import type { ExecutionResult, ToolCallRecord } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

interface ToolSpec {
  tool: string;
}

function isToolSpecArray(value: unknown): value is ToolSpec[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' && item !== null && typeof (item as ToolSpec).tool === 'string',
    )
  );
}

/**
 * Tool-calls grader — validates tool call behavior from trace.turns[].toolCalls.
 *
 * Config:
 *   required?: Array<{ tool: string }>    — tools that must appear at least once
 *   forbidden?: Array<{ tool: string }>   — tools that must not appear
 *   maxCalls?: number                     — maximum total number of tool calls
 *   minCalls?: number                     — minimum total number of tool calls
 *
 * At least one config field must be provided.
 */
export async function toolCalls(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const required = config.required;
  const forbidden = config.forbidden;
  const maxCalls = config.maxCalls;
  const minCalls = config.minCalls;

  if (!required && !forbidden && maxCalls === undefined && minCalls === undefined) {
    return {
      pass: false,
      reason: "Config must provide 'required', 'forbidden', 'maxCalls', or 'minCalls'.",
    };
  }

  if (required !== undefined && !isToolSpecArray(required)) {
    return { pass: false, reason: "'required' must be an array of { tool: string }." };
  }

  if (forbidden !== undefined && !isToolSpecArray(forbidden)) {
    return { pass: false, reason: "'forbidden' must be an array of { tool: string }." };
  }

  // Collect all tool calls from trace turns
  const allCalls: ToolCallRecord[] = [];
  if (result.trace?.turns) {
    for (const turn of result.trace.turns) {
      if (turn.toolCalls) {
        allCalls.push(...turn.toolCalls);
      }
    }
  }

  const calledTools = new Set(allCalls.map((tc) => tc.tool));
  const failures: string[] = [];

  if (required) {
    for (const spec of required) {
      if (!calledTools.has(spec.tool)) {
        failures.push(`Required tool '${spec.tool}' was not called.`);
      }
    }
  }

  if (forbidden) {
    for (const spec of forbidden) {
      if (calledTools.has(spec.tool)) {
        failures.push(`Forbidden tool '${spec.tool}' was called.`);
      }
    }
  }

  if (minCalls !== undefined && typeof minCalls === 'number') {
    if (allCalls.length < minCalls) {
      failures.push(`Total tool calls ${allCalls.length} is below minimum ${minCalls}.`);
    }
  }

  if (maxCalls !== undefined && typeof maxCalls === 'number') {
    if (allCalls.length > maxCalls) {
      failures.push(`Total tool calls ${allCalls.length} exceeds maximum ${maxCalls}.`);
    }
  }

  if (failures.length > 0) {
    return { pass: false, reason: failures.join(' ') };
  }

  return {
    pass: true,
    reason: 'All tool-call checks passed.',
    meta: { totalCalls: allCalls.length, calledTools: [...calledTools] },
  };
}
