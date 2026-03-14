import type { ErrorCategory, ErrorCode } from './error-codes.js';

export interface BaseYouEvalErrorOptions {
  category: ErrorCategory;
  code: ErrorCode;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class BaseYouEvalError extends Error {
  public readonly category: ErrorCategory;
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, options: BaseYouEvalErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'BaseYouEvalError';
    this.category = options.category;
    this.code = options.code;
    this.details = options.details;
  }
}
