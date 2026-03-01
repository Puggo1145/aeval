import type { Grader, GraderRegistry } from '../contracts/runtime.js';
import { ContractError, ValidationError } from '../errors/index.js';

function normalizeGraderType(type: string, field: string): string {
  const normalizedType = type.trim();
  if (normalizedType.length > 0) {
    return normalizedType;
  }

  throw new ValidationError(`Field '${field}' must be a non-empty string.`, {
    details: {
      field,
      type,
    },
  });
}

export class InMemoryGraderRegistry implements GraderRegistry {
  private readonly graders = new Map<string, Grader>();

  register(type: string, grader: Grader): void {
    const normalizedType = normalizeGraderType(type, 'type');

    if (this.graders.has(normalizedType)) {
      throw new ContractError(`Grader '${normalizedType}' is already registered.`, {
        details: {
          type: normalizedType,
        },
      });
    }

    this.graders.set(normalizedType, grader);
  }

  get(type: string): Grader | undefined {
    const normalizedType = type.trim();
    if (normalizedType.length === 0) {
      return undefined;
    }
    return this.graders.get(normalizedType);
  }

  has(type: string): boolean {
    return this.get(type) !== undefined;
  }

  list(): string[] {
    return [...this.graders.keys()];
  }
}
