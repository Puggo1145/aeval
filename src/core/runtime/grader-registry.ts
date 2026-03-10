import type { Grader, Graders as GradersContract } from '../contracts/runtime.js';
import { ContractError, ValidationError } from '../errors/index.js';

function normalizeGraderType(type: string): string {
  const normalizedType = type.trim();
  if (normalizedType.length > 0) {
    return normalizedType;
  }

  throw new ValidationError(`Field 'grader.type' must be a non-empty string.`, {
    details: {
      field: 'grader.type',
      value: type,
    },
  });
}

export class Graders implements GradersContract {
  private readonly registry = new Map<string, Grader>();

  register(grader: Grader): void {
    const type = normalizeGraderType(grader.type);

    if (this.registry.has(type)) {
      throw new ContractError(`Grader '${type}' is already registered.`, {
        details: {
          type,
        },
      });
    }

    this.registry.set(type, grader);
  }

  get(type: string): Grader | undefined {
    return this.registry.get(normalizeGraderType(type));
  }

  require(type: string): Grader {
    const grader = this.get(type);
    if (!grader) {
      throw new ContractError(`Grader '${type}' is not registered.`, {
        details: {
          type,
          available: this.list(),
        },
      });
    }

    return grader;
  }

  has(type: string): boolean {
    return this.get(type) !== undefined;
  }

  list(): string[] {
    return [...this.registry.keys()];
  }
}
