import type { ErrorCategory, ErrorCode } from './error-codes.js';

export interface BaseAEvalErrorOptions {
  category: ErrorCategory;
  code: ErrorCode;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class BaseAEvalError extends Error {
  public readonly category: ErrorCategory;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, options: BaseAEvalErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'BaseAEvalError';
    this.category = options.category;
    this.code = options.code;
    this.details = options.details;
  }
}
