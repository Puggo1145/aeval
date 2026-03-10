import type { TaskIndex, Tasks } from '../adapters/task-source-adapter.js';
import type { SuiteDocument } from '../contracts/suite.js';
import { parseSuiteDocument } from '../contracts/suite.js';
import type { RunEvent } from './run-event.js';
import type { RunSummary } from './run-summary.js';

export interface SuiteSource {
  adapter: string;
  ref: string;
  fetchedAt: string;
}

export interface SuiteActions {
  listTasks(): Promise<TaskIndex[]>;
  runTask(taskId: string): Promise<RunSummary[]>;
  streamTask(taskId: string, options?: { signal?: AbortSignal }): AsyncIterable<RunEvent>;
}

export interface SuiteInit {
  document: unknown;
  source?: SuiteSource;
  taskIndexes?: TaskIndex[];
  tasks?: Tasks;
  actions?: SuiteActions;
}

export class Suite {
  readonly schemaVersion: SuiteDocument['schemaVersion'];
  readonly id: string;
  readonly name: string;
  readonly discover: readonly string[];
  readonly source?: SuiteSource;
  readonly taskIndexes?: readonly TaskIndex[];

  private readonly tasks?: Tasks;
  private readonly actions?: SuiteActions;

  constructor(input: SuiteInit) {
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

    this.tasks = input.tasks;
    this.actions = input.actions;
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

  withActions(actions: SuiteActions, tasks?: Tasks): Suite {
    return new Suite({
      document: this.toDocument(),
      ...(this.source !== undefined ? { source: this.source } : {}),
      ...(this.taskIndexes !== undefined ? { taskIndexes: [...this.taskIndexes] } : {}),
      actions,
      tasks: tasks ?? this.tasks,
    });
  }

  async listTasks(): Promise<TaskIndex[]> {
    if (this.actions) {
      return this.actions.listTasks();
    }

    if (this.taskIndexes) {
      return [...this.taskIndexes];
    }

    if (!this.tasks) {
      throw new Error(`Suite '${this.id}' is not bound to a tasks source.`);
    }

    const resolved = await this.tasks.resolveSuite(this.id);
    return resolved.listTasks();
  }

  async runTask(taskId: string): Promise<RunSummary[]> {
    if (!this.actions) {
      throw new Error(`Suite '${this.id}' is not bound to Core runtime actions.`);
    }

    return this.actions.runTask(taskId);
  }

  streamTask(taskId: string, options?: { signal?: AbortSignal }): AsyncIterable<RunEvent> {
    if (!this.actions) {
      throw new Error(`Suite '${this.id}' is not bound to Core runtime actions.`);
    }

    return this.actions.streamTask(taskId, options);
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
