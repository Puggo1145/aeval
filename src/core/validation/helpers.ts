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
    case 'invalid_type': {
      const details: Record<string, unknown> = {};
      if ('expected' in issue) {
        details.expected = issue.expected;
      }
      if ('received' in issue) {
        details.receivedType = issue.received;
      }
      return Object.keys(details).length > 0 ? details : undefined;
    }
    case 'too_small': {
      const details: Record<string, unknown> = {};
      if ('minimum' in issue) {
        details.minimum = issue.minimum;
      }
      if ('inclusive' in issue) {
        details.inclusive = issue.inclusive;
      }
      if ('exact' in issue) {
        details.exact = issue.exact;
      }
      if ('origin' in issue) {
        details.origin = issue.origin;
      }
      return Object.keys(details).length > 0 ? details : undefined;
    }
    case 'too_big': {
      const details: Record<string, unknown> = {};
      if ('maximum' in issue) {
        details.maximum = issue.maximum;
      }
      if ('inclusive' in issue) {
        details.inclusive = issue.inclusive;
      }
      if ('exact' in issue) {
        details.exact = issue.exact;
      }
      if ('origin' in issue) {
        details.origin = issue.origin;
      }
      return Object.keys(details).length > 0 ? details : undefined;
    }
    case 'invalid_value': {
      const details: Record<string, unknown> = {};
      if ('values' in issue) {
        details.expected = issue.values;
      }
      if ('input' in issue) {
        details.received = issue.input;
      }
      return Object.keys(details).length > 0 ? details : undefined;
    }
    case 'custom':
      return 'params' in issue ? issue.params : undefined;
    default:
      return undefined;
  }
}

function normalizeZodIssueMessage(issue: ZodIssue, field: string): string {
  if (issue.code === 'invalid_value' && field.endsWith('.schemaVersion')) {
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

  if (issue.code === 'too_small' && 'origin' in issue && issue.origin === 'string') {
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

export function ensureNonEmptyString(value: string, field: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue.length > 0) {
    return normalizedValue;
  }

  throwValidationError(`Field '${field}' must be a non-empty string.`, field, {
    value,
  });
}

export function ensureSchemaVersion(value: unknown, expected: string, field: string): void {
  if (value !== expected) {
    throwValidationError(`Unsupported schema version at '${field}'.`, field, {
      expected,
      received: value,
    });
  }
}
