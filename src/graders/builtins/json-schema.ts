import { Ajv } from 'ajv';
import { z } from 'zod';
import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';
import { type GraderConfigValidationResult, parseGraderConfig } from '../config-validation.js';

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateSchema: true,
});

const JsonSchemaConfigSchema = z
  .object({
    schema: z.record(z.unknown()),
  })
  .strict();

type JsonSchemaConfig = z.infer<typeof JsonSchemaConfigSchema>;

function getAjvErrorsText(): string {
  const reason = ajv.errorsText(ajv.errors, { separator: '; ' });
  return reason.length > 0 ? reason : 'Invalid JSON Schema.';
}

function validateJsonSchemaDefinition(schema: Record<string, unknown>): string | null {
  const valid = ajv.validateSchema(schema);
  if (valid) {
    return null;
  }

  return `Invalid JSON Schema: ${getAjvErrorsText()}`;
}

function compileJsonSchema(
  schema: Record<string, unknown>,
): { ok: true; validate: ReturnType<typeof ajv.compile> } | { ok: false; reason: string } {
  try {
    const validate = ajv.compile(schema);
    return { ok: true, validate };
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * JSON schema grader — validates `structuredOutput` against JSON Schema via Ajv.
 *
 * Config:
 *   schema: object — JSON Schema object
 */
export async function jsonSchema(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const parsed = parseGraderConfig(JsonSchemaConfigSchema, config);
  if (!parsed.ok) {
    return {
      pass: false,
      reason: parsed.reason,
    };
  }
  const parsedConfig: JsonSchemaConfig = parsed.config;

  const schemaError = validateJsonSchemaDefinition(parsedConfig.schema);
  if (schemaError) {
    return { pass: false, reason: schemaError };
  }

  const compiled = compileJsonSchema(parsedConfig.schema);
  if (!compiled.ok) {
    return { pass: false, reason: compiled.reason };
  }

  if (result.structuredOutput === undefined) {
    return { pass: false, reason: 'structuredOutput is undefined.' };
  }

  const valid = compiled.validate(result.structuredOutput);
  if (!valid) {
    const reason = ajv.errorsText(compiled.validate.errors, { separator: '; ' });
    return {
      pass: false,
      reason: reason.length > 0 ? reason : 'structuredOutput does not match schema.',
    };
  }

  return { pass: true, reason: 'structuredOutput matches schema.' };
}

function validateJsonSchemaConfig(
  config: Record<string, unknown>,
): GraderConfigValidationResult {
  const parsed = parseGraderConfig(JsonSchemaConfigSchema, config);
  if (!parsed.ok) {
    return {
      valid: false,
      reason: parsed.reason,
    };
  }

  const schemaError = validateJsonSchemaDefinition(parsed.config.schema);
  if (schemaError) {
    return {
      valid: false,
      reason: schemaError,
    };
  }

  const compiled = compileJsonSchema(parsed.config.schema);
  if (!compiled.ok) {
    return {
      valid: false,
      reason: compiled.reason,
    };
  }

  return { valid: true };
}

(
  jsonSchema as typeof jsonSchema & {
    validateConfig: (config: Record<string, unknown>) => GraderConfigValidationResult;
  }
).validateConfig = validateJsonSchemaConfig;
