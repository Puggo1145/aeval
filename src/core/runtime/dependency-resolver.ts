import type { Grader, Graders, Provider, Providers } from '../contracts/runtime.js';

export function resolveProviderOrThrow(providerId: string, providers: Providers): Provider {
  return providers.require(providerId);
}

export function resolveGraderOrThrow(type: string, graders: Graders): Grader {
  return graders.require(type);
}
