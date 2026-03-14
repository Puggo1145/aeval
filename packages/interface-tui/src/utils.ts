import * as p from '@clack/prompts';

class CancelError extends Error {
  constructor() {
    super('Operation cancelled.');
    this.name = 'CancelError';
  }
}

export { CancelError };

export function handleCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    throw new CancelError();
  }
  return value;
}
