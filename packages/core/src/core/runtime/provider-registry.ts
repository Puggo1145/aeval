import type { Provider, Providers as ProvidersContract } from '../contracts/runtime.js';
import { KeyedRegistry } from './keyed-registry.js';

export class Providers extends KeyedRegistry<Provider> implements ProvidersContract {
  constructor() {
    super({ kind: 'Provider', idField: 'provider.id', detailsKey: 'providerId' });
  }

  protected keyOf(provider: Provider): string {
    return provider.id;
  }
}
