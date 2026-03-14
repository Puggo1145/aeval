import { BaseYouEvalError } from './base-error.js';
import {
  type ContractErrorCode,
  ERROR_CATEGORIES,
  ERROR_CODES,
  type RuntimeErrorCode,
  type StoreErrorCode,
  type ValidationErrorCode,
} from './error-codes.js';

interface ErrorOptions<TCode extends string> {
  code?: TCode;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class ContractError extends BaseYouEvalError {
  constructor(message: string, options: ErrorOptions<ContractErrorCode> = {}) {
    super(message, {
      category: ERROR_CATEGORIES.CONTRACT,
      code: options.code ?? ERROR_CODES.CONTRACT_VIOLATION,
      details: options.details,
      cause: options.cause,
    });
    this.name = 'ContractError';
  }
}

export class ValidationError extends BaseYouEvalError {
  constructor(message: string, options: ErrorOptions<ValidationErrorCode> = {}) {
    super(message, {
      category: ERROR_CATEGORIES.VALIDATION,
      code: options.code ?? ERROR_CODES.VALIDATION_INVALID_INPUT,
      details: options.details,
      cause: options.cause,
    });
    this.name = 'ValidationError';
  }
}

export class RuntimeError extends BaseYouEvalError {
  constructor(message: string, options: ErrorOptions<RuntimeErrorCode> = {}) {
    super(message, {
      category: ERROR_CATEGORIES.RUNTIME,
      code: options.code ?? ERROR_CODES.RUNTIME_UNEXPECTED,
      details: options.details,
      cause: options.cause,
    });
    this.name = 'RuntimeError';
  }
}

export class StoreError extends BaseYouEvalError {
  constructor(message: string, options: ErrorOptions<StoreErrorCode> = {}) {
    super(message, {
      category: ERROR_CATEGORIES.STORE,
      code: options.code ?? ERROR_CODES.STORE_FAILURE,
      details: options.details,
      cause: options.cause,
    });
    this.name = 'StoreError';
  }
}
