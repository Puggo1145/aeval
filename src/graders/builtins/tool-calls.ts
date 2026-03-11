import { z } from 'zod';
import type {
  ExecutionResult,
  GraderResult,
  ToolCallRecord,
} from '../../index.js';
import { ConfiguredGrader } from '../base-grader.js';
import {
  type GraderConfigValidationResult,
  parseGraderConfig,
  validateGraderConfig,
} from '../config-validation.js';

const ToolSpecSchema = z
  .object({
    tool: z.string().min(1, "Field 'tool' must be a non-empty string."),
  })
  .strict();

const ToolCallsConfigSchema = z
  .object({
    required: z.array(ToolSpecSchema).min(1).optional(),
    forbidden: z.array(ToolSpecSchema).min(1).optional(),
    maxCalls: z.number().int().finite().nonnegative().optional(),
    minCalls: z.number().int().finite().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAnyConstraint =
      value.required !== undefined ||
      value.forbidden !== undefined ||
      value.maxCalls !== undefined ||
      value.minCalls !== undefined;
    if (!hasAnyConstraint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Config must provide 'required', 'forbidden', 'maxCalls', or 'minCalls'.",
      });
    }

    if (
      value.minCalls !== undefined &&
      value.maxCalls !== undefined &&
      value.minCalls > value.maxCalls
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minCalls'],
        message: "Field 'minCalls' must be less than or equal to 'maxCalls'.",
      });
    }
  });

type ToolCallsConfig = z.infer<typeof ToolCallsConfigSchema>;

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
async function gradeToolCalls(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(ToolCallsConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: ToolCallsConfig = parsed.config;

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

  if (parsedConfig.required) {
    for (const spec of parsedConfig.required) {
      if (!calledTools.has(spec.tool)) {
        failures.push(`Required tool '${spec.tool}' was not called.`);
      }
    }
  }

  if (parsedConfig.forbidden) {
    for (const spec of parsedConfig.forbidden) {
      if (calledTools.has(spec.tool)) {
        failures.push(`Forbidden tool '${spec.tool}' was called.`);
      }
    }
  }

  if (parsedConfig.minCalls !== undefined) {
    if (allCalls.length < parsedConfig.minCalls) {
      failures.push(
        `Total tool calls ${allCalls.length} is below minimum ${parsedConfig.minCalls}.`,
      );
    }
  }

  if (parsedConfig.maxCalls !== undefined) {
    if (allCalls.length > parsedConfig.maxCalls) {
      failures.push(
        `Total tool calls ${allCalls.length} exceeds maximum ${parsedConfig.maxCalls}.`,
      );
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

export const toolCalls = new ConfiguredGrader({
  type: 'tool-calls',
  grade: (result, layer) => gradeToolCalls(result, layer.config),
  validate: (layer): GraderConfigValidationResult =>
    validateGraderConfig(ToolCallsConfigSchema, layer.config),
});
