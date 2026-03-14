import type { SuiteSource, TaskIndex } from '../adapters/task-source-adapter.js';
import type { SuiteDocument } from '../contracts/suite.js';
import { parseSuiteDocument } from '../contracts/suite.js';

interface SuiteInit {
  document: unknown;
  source?: SuiteSource;
  taskIndexes?: TaskIndex[];
}

export class Suite {
  readonly schemaVersion: SuiteDocument['schemaVersion'];
  readonly id: string;
  readonly name: string;
  readonly discover: readonly string[];
  readonly source?: SuiteSource;
  readonly taskIndexes?: readonly TaskIndex[];

  private constructor(input: SuiteInit) {
    const document = parseSuiteDocument(input.document);

    this.schemaVersion = document.schemaVersion;
    this.id = document.id;
    this.name = document.name;
    this.discover = Object.freeze([...document.discover]);

    if (input.source !== undefined) {
      this.source = Object.freeze({ ...input.source });
    }
    if (input.taskIndexes !== undefined) {
      this.taskIndexes = Object.freeze([...input.taskIndexes]);
    }
  }

  get definition(): SuiteDocument {
    return this.toDocument();
  }

  static fromDocument(document: unknown, options: Omit<SuiteInit, 'document'> = {}): Suite {
    return new Suite({
      document,
      ...options,
    });
  }

  toDocument(): SuiteDocument {
    return {
      schemaVersion: this.schemaVersion,
      id: this.id,
      name: this.name,
      discover: [...this.discover],
    };
  }
}
