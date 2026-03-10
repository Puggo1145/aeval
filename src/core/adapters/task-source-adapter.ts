import type { SuiteDocument } from '../contracts/suite.js';
import type { TaskDocument } from '../contracts/task.js';

export interface SuiteDescriptor {
  id: string;
  name: string;
  ref: string;
}

export interface SuiteSource {
  adapter: string;
  ref: string;
  fetchedAt: string;
}

export interface TaskSource {
  adapter: string;
  ref: string;
  revision: string;
  fetchedAt: string;
}

export interface TaskRef {
  suiteId: string;
  ref: string;
}

export interface TaskIndex {
  id: string;
  desc?: string;
  category?: string;
  capability?: string;
  tier?: string;
  difficulty?: string;
  tags?: string[];
  runCount: number;
  taskRef: TaskRef;
}

export interface ResolvedSuite {
  document: SuiteDocument;
  source?: SuiteSource;
  taskIndexes: TaskIndex[];
}

export interface ResolvedTask {
  document: TaskDocument;
  source: TaskSource;
}

export interface Tasks {
  listSuites(): Promise<SuiteDescriptor[]>;
  resolveSuite(suiteId: string): Promise<ResolvedSuite>;
  resolveTask(taskRef: TaskRef): Promise<ResolvedTask>;
}

export type SuiteInput = SuiteDocument;
export type TaskInput = TaskDocument;
