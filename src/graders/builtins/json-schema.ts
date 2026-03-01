import type { ExecutionResult } from '../../core/contracts/execution.js';
import type { GraderResult } from '../../core/contracts/trial.js';

/**
 * JSON schema grader — validates `structuredOutput` against a JSON Schema subset.
 *
 * Config:
 *   schema: object — JSON Schema (supports type, properties, required, items, enum,
 *                    minimum, maximum, minLength, maxLength, pattern, additionalProperties)
 *
 * This is a lightweight validator covering the most common JSON Schema draft-07 keywords.
 * For full spec compliance, consider using an external validator (e.g., ajv).
 */
export async function jsonSchema(
  result: ExecutionResult,
  config: Record<string, unknown>,
): Promise<GraderResult> {
  const schema = config.schema;
  if (typeof schema !== 'object' || schema === null) {
    return { pass: false, reason: "Config 'schema' must be a non-null object." };
  }

  if (result.structuredOutput === undefined) {
    return { pass: false, reason: 'structuredOutput is undefined.' };
  }

  const errors = validateValue(result.structuredOutput, schema as SchemaNode, '');
  if (errors.length > 0) {
    return { pass: false, reason: errors.join('; ') };
  }

  return { pass: true, reason: 'structuredOutput matches schema.' };
}

// -- Lightweight JSON Schema validator --

interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  const?: unknown;
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object' | 'undefined'
}

function matchesType(value: unknown, expected: string): boolean {
  const actual = jsonType(value);
  if (expected === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }
  return actual === expected;
}

function validateValue(value: unknown, schema: SchemaNode, path: string): string[] {
  const errors: string[] = [];
  const prefix = path || '$';

  // type check
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${prefix}: expected type ${types.join('|')}, got ${jsonType(value)}`);
      return errors; // short-circuit on type mismatch
    }
  }

  // const check
  if (schema.const !== undefined) {
    if (!deepEqual(value, schema.const)) {
      errors.push(`${prefix}: value does not match const`);
    }
  }

  // enum check
  if (schema.enum !== undefined) {
    if (!schema.enum.some((e) => deepEqual(value, e))) {
      errors.push(`${prefix}: value not in enum [${schema.enum.map(String).join(', ')}]`);
    }
  }

  // string constraints
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${prefix}: string length ${value.length} < minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${prefix}: string length ${value.length} > maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined) {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        errors.push(`${prefix}: string does not match pattern /${schema.pattern}/`);
      }
    }
  }

  // number constraints
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${prefix}: ${value} < minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${prefix}: ${value} > maximum ${schema.maximum}`);
    }
  }

  // object constraints
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;

    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          errors.push(`${prefix}: missing required property '${key}'`);
        }
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          errors.push(...validateValue(obj[key], propSchema, `${prefix}.${key}`));
        }
      }

      if (schema.additionalProperties === false) {
        const allowedKeys = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(obj)) {
          if (!allowedKeys.has(key)) {
            errors.push(`${prefix}: unexpected property '${key}'`);
          }
        }
      }
    }
  }

  // array constraints
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateValue(value[i], schema.items, `${prefix}[${i}]`));
    }
  }

  return errors;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
