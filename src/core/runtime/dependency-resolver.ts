// 从 registry 中解析出 provider / grader 实例

import type { Grader, GraderRegistry, ProviderRegistry, TaskProvider } from '../contracts/runtime.js';
import { ERROR_CODES, RuntimeError } from '../errors/index.js';

interface MissingDependencyDetails extends Record<string, unknown> {
  field: string;
  dependencyType: string;
  requestedId: string;
  available: string[];
}

function throwMissingDependencyError(details: MissingDependencyDetails): never {
  throw new RuntimeError(
    `Unable to resolve ${details.dependencyType} '${details.requestedId}' from '${details.field}'.`,
    {
      code: ERROR_CODES.RUNTIME_DEPENDENCY_MISSING,
      details,
    },
  );
}

export function resolveProviderOrThrow(
  providerId: string,
  providerRegistry: ProviderRegistry,
): TaskProvider {
  const normalizedProviderId = providerId.trim();
  const provider = providerRegistry.get(normalizedProviderId);
  if (provider) {
    return provider;
  }

  throwMissingDependencyError({
    field: 'task.provider.id',
    dependencyType: 'provider',
    requestedId: normalizedProviderId,
    available: providerRegistry.list(),
  });
}

export function resolveGraderOrThrow(type: string, graderRegistry: GraderRegistry): Grader {
  const normalizedType = type.trim();
  const grader = graderRegistry.get(normalizedType);
  if (grader) {
    return grader;
  }

  throwMissingDependencyError({
    field: 'task.graders.layers[].type',
    dependencyType: 'grader',
    requestedId: normalizedType,
    available: graderRegistry.list(),
  });
}
