import { ERROR_CODES, RuntimeError } from '../errors/index.js';

interface MissingDependencyDetails extends Record<string, unknown> {
  field: string;
  dependencyType: string;
  requestedId: string;
  available: string[];
}

export function throwMissingDependencyError(details: MissingDependencyDetails): never {
  throw new RuntimeError(
    `Unable to resolve ${details.dependencyType} '${details.requestedId}' from '${details.field}'.`,
    {
      code: ERROR_CODES.RUNTIME_DEPENDENCY_MISSING,
      details,
    },
  );
}
