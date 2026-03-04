import type { ProviderRegistry, TaskProvider } from '../contracts/runtime.js';
import { ContractError, ValidationError } from '../errors/index.js';

function normalizeProviderId(providerId: string): string {
  const normalizedProviderId = providerId.trim();
  if (normalizedProviderId.length > 0) {
    return normalizedProviderId;
  }

  throw new ValidationError(`Field 'providerId' must be a non-empty string.`, {
    details: {
      field: 'providerId',
      value: providerId,
    },
  });
}

export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<string, TaskProvider>();

  register(providerId: string, provider: TaskProvider): void {
    const normalizedProviderId = normalizeProviderId(providerId);

    if (this.providers.has(normalizedProviderId)) {
      throw new ContractError(`Provider '${normalizedProviderId}' is already registered.`, {
        details: {
          providerId: normalizedProviderId,
        },
      });
    }

    this.providers.set(normalizedProviderId, provider);
  }

  get(providerId: string): TaskProvider | undefined {
    const normalizedProviderId = normalizeProviderId(providerId);
    return this.providers.get(normalizedProviderId);
  }

  has(providerId: string): boolean {
    return this.get(providerId) !== undefined;
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}
