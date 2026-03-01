import type { ZodError, ZodIssue } from 'zod';
import { ValidationError } from '../errors/index.js';

export type UnknownRecord = Record<string, unknown>;

export function throwValidationError(
  message: string,
  field: string,
  details?: Record<string, unknown>,
): never {
  throw new ValidationError(message, {
    details: {
      field,
      ...details,
    },
  });
}

type ValidationPathSegment = string | number;

function joinValidationPath(baseField: string, segments: readonly ValidationPathSegment[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === 'number') {
      return `${path}[${segment}]`;
    }
    return `${path}.${segment}`;
  }, baseField);
}

function toZodIssueDetails(issue: ZodIssue): Record<string, unknown> | undefined {
  switch (issue.code) {
    case 'invalid_type':
      return {
        expected: issue.expected,
        receivedType: issue.received,
      };
    case 'invalid_literal':
      return {
        expected: issue.expected,
        received: issue.received,
      };
    case 'invalid_enum_value':
      return {
        expected: issue.options,
        received: issue.received,
      };
    case 'too_small':
      return {
        minimum: issue.minimum,
        inclusive: issue.inclusive,
        exact: issue.exact,
        type: issue.type,
      };
    case 'too_big':
      return {
        maximum: issue.maximum,
        inclusive: issue.inclusive,
        exact: issue.exact,
        type: issue.type,
      };
    case 'custom':
      return issue.params;
    default:
      return undefined;
  }
}

function normalizeZodIssueMessage(issue: ZodIssue, field: string): string {
  if (issue.code === 'invalid_literal' && field.endsWith('.schemaVersion')) {
    return `Unsupported schema version at '${field}'.`;
  }

  if (issue.code === 'invalid_type') {
    if (issue.expected === 'object') {
      return `Field '${field}' must be an object.`;
    }
    if (issue.expected === 'array') {
      return `Field '${field}' must be an array.`;
    }
    if (issue.expected === 'string') {
      return `Field '${field}' must be a non-empty string.`;
    }
  }

  if (issue.code === 'too_small' && issue.type === 'string') {
    return `Field '${field}' must be a non-empty string.`;
  }

  return issue.message;
}

export function throwFirstZodValidationError(error: ZodError, baseField: string): never {
  const [firstIssue] = error.issues;
  if (!firstIssue) {
    throwValidationError('Validation failed.', baseField);
  }

  const field = joinValidationPath(baseField, firstIssue.path as ValidationPathSegment[]);
  const details = toZodIssueDetails(firstIssue);
  const message = normalizeZodIssueMessage(firstIssue, field);
  throwValidationError(message, field, details);
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ensureSchemaVersion(value: unknown, expected: string, field: string): void {
  if (value !== expected) {
    throwValidationError(`Unsupported schema version at '${field}'.`, field, {
      expected,
      received: value,
    });
  }
}
