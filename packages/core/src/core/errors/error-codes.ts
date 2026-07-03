export const ERROR_CODES = {
  // Contract violations are programming errors, e.g. registering a duplicate grader/provider.
  CONTRACT_VIOLATION: 'CONTRACT_VIOLATION',
  VALIDATION_INVALID_INPUT: 'VALIDATION_INVALID_INPUT',
  RUNTIME_UNEXPECTED: 'RUNTIME_UNEXPECTED',
  STORE_FAILURE: 'STORE_FAILURE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export type ContractErrorCode = typeof ERROR_CODES.CONTRACT_VIOLATION;
export type ValidationErrorCode = typeof ERROR_CODES.VALIDATION_INVALID_INPUT;
export type RuntimeErrorCode = typeof ERROR_CODES.RUNTIME_UNEXPECTED;
export type StoreErrorCode = typeof ERROR_CODES.STORE_FAILURE;

export const ERROR_CATEGORIES = {
  CONTRACT: 'contract',
  VALIDATION: 'validation',
  RUNTIME: 'runtime',
  STORE: 'store',
} as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[keyof typeof ERROR_CATEGORIES];
