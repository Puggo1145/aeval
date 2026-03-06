import type { SuiteDefinition } from '../contracts/suite.js';
import type { TaskDefinition } from '../contracts/task.js';

export interface SuiteDescriptor {
  id: string;
  name: string;
  // suite 的定位字段，取决于 task source adapter 的实现
  ref: string;
}

export interface TaskRef {
  suiteId: string;
  // task 的定位字段，取决于 task source adapter 的实现
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

export interface TaskSourceAdapter {
  listSuites(): Promise<SuiteDescriptor[]>;
  resolveSuite(suiteId: string): Promise<ResolvedSuite>;
  resolveTask(taskRef: TaskRef): Promise<ResolvedTask>;
}

export interface ResolvedSuite {
  source: {
    adapter: string;
    ref: string;
    fetchedAt: string;
  };
  suite: SuiteDefinition;
  tasks: TaskIndex[];
}

export interface ResolvedTask {
  source: {
    adapter: string;
    ref: string;
    revision: string;
    fetchedAt: string;
  };
  task: TaskDefinition;
}
