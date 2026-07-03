import { ContractError, ValidationError } from '../errors/index.js';

interface KeyedRegistryLabels {
  /** Human-readable kind used in error messages, e.g. "Provider". */
  kind: string;
  /** Field path reported when a key is empty, e.g. "provider.id". */
  idField: string;
  /** Details key used in error payloads, e.g. "providerId". */
  detailsKey: string;
}

/**
 * Shared registration/lookup behavior for the provider and grader registries.
 * Keys are trimmed, must be non-empty, and must be unique.
 */
export abstract class KeyedRegistry<T> {
  private readonly entries = new Map<string, T>();

  protected constructor(private readonly labels: KeyedRegistryLabels) {}

  protected abstract keyOf(item: T): string;

  register(item: T): void {
    const key = this.normalizeKey(this.keyOf(item));

    if (this.entries.has(key)) {
      throw new ContractError(`${this.labels.kind} '${key}' is already registered.`, {
        details: {
          [this.labels.detailsKey]: key,
        },
      });
    }

    this.entries.set(key, item);
  }

  get(key: string): T | undefined {
    return this.entries.get(this.normalizeKey(key));
  }

  require(key: string): T {
    const item = this.get(key);
    if (!item) {
      throw new ContractError(`${this.labels.kind} '${key}' is not registered.`, {
        details: {
          [this.labels.detailsKey]: key,
          available: this.list(),
        },
      });
    }

    return item;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  private normalizeKey(key: string): string {
    const normalized = key.trim();
    if (normalized.length > 0) {
      return normalized;
    }

    throw new ValidationError(`Field '${this.labels.idField}' must be a non-empty string.`, {
      details: {
        field: this.labels.idField,
        value: key,
      },
    });
  }
}
