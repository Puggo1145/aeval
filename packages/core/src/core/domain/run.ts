import type { TaskProviderRunDocument } from '../contracts/task.js';
import { cloneAndFreezeRecord } from '../utils/immutability.js';
import { ensureNonEmptyString } from '../validation/helpers.js';

export interface RunInit {
  name: string;
  params?: Record<string, unknown>;
}

export class Run {
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;

  constructor(input: RunInit) {
    this.name = ensureNonEmptyString(input.name, 'run.name');
    this.params = cloneAndFreezeRecord(input.params);
  }

  static fromDocument(document: TaskProviderRunDocument): Run {
    return new Run({
      name: document.name,
      params: document.params,
    });
  }

  toDocument(): TaskProviderRunDocument {
    return {
      name: this.name,
      params: { ...this.params },
    };
  }
}
