import type { SuiteDocument } from '../contracts/suite.js';
import type { TaskDocument } from '../contracts/task.js';
import type { Suite } from '../domain/suite.js';
import type { Task } from '../domain/task.js';

export interface SuiteDescriptor {
  id: string;
  name: string;
  ref: string;
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

export interface Tasks {
  listSuites(): Promise<SuiteDescriptor[]>;
  resolveSuite(suiteId: string): Promise<Suite>;
  resolveTask(taskRef: TaskRef): Promise<Task>;
}

export type SuiteInput = SuiteDocument;
export type TaskInput = TaskDocument;
