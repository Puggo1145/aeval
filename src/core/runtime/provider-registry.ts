import type { Provider, Providers as ProvidersContract } from '../contracts/runtime.js';
import { ContractError, ValidationError } from '../errors/index.js';

function normalizeProviderId(providerId: string): string {
  const normalizedProviderId = providerId.trim();
  if (normalizedProviderId.length > 0) {
    return normalizedProviderId;
  }

  throw new ValidationError(`Field 'provider.id' must be a non-empty string.`, {
    details: {
      field: 'provider.id',
      value: providerId,
    },
  });
}

export class Providers implements ProvidersContract {
  private readonly registry = new Map<string, Provider>();

  register(provider: Provider): void {
    const providerId = normalizeProviderId(provider.id);

    if (this.registry.has(providerId)) {
      throw new ContractError(`Provider '${providerId}' is already registered.`, {
        details: {
          providerId,
        },
      });
    }

    this.registry.set(providerId, provider);
  }

  get(providerId: string): Provider | undefined {
    return this.registry.get(normalizeProviderId(providerId));
  }

  require(providerId: string): Provider {
    const provider = this.get(providerId);
    if (!provider) {
      throw new ContractError(`Provider '${providerId}' is not registered.`, {
        details: {
          providerId,
          available: this.list(),
        },
      });
    }

    return provider;
  }

  has(providerId: string): boolean {
    return this.get(providerId) !== undefined;
  }

  list(): string[] {
    return [...this.registry.keys()];
  }
}
