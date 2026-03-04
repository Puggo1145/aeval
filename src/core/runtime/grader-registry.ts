import type { Grader, GraderRegistry } from '../contracts/runtime.js';
import { ContractError, ValidationError } from '../errors/index.js';

function normalizeGraderType(type: string): string {
  const normalizedType = type.trim();
  if (normalizedType.length > 0) {
    return normalizedType;
  }

  throw new ValidationError(`Field 'type' must be a non-empty string.`, {
    details: {
      field: 'type',
      value: type,
    },
  });
}

export class InMemoryGraderRegistry implements GraderRegistry {
  private readonly graders = new Map<string, Grader>();

  register(type: string, grader: Grader): void {
    const normalizedType = normalizeGraderType(type);

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
    const normalizedType = normalizeGraderType(type);
    return this.graders.get(normalizedType);
  }

  has(type: string): boolean {
    const normalizedType = normalizeGraderType(type);
    return this.graders.has(normalizedType);
  }

  list(): string[] {
    return [...this.graders.keys()];
  }
}
