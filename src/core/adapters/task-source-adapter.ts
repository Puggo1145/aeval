export interface SuiteDescriptor {
  id: string;
  name: string;
  ref: string;
}

export interface SuiteSource {
  adapter: string;
  ref: string;
}

export interface TaskSource {
  adapter: string;
  ref: string;
  revision: string;
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

// Adapters return raw deserialized suite input. Runtime validation happens when
// Core constructs the Suite domain object.
export type SuiteInput = unknown;

export interface ResolvedSuite {
  document: SuiteInput;
  source?: SuiteSource;
  taskRefs: TaskRef[];
}

// Adapters return raw deserialized task input. Runtime validation happens when
// Core constructs the Task domain object.
export type TaskInput = unknown;

export interface ResolvedTask {
  document: TaskInput;
  source: TaskSource;
}

export interface Tasks {
  listSuites(): Promise<SuiteDescriptor[]>;
  resolveSuite(suiteId: string): Promise<ResolvedSuite>;
  resolveTask(taskRef: TaskRef): Promise<ResolvedTask>;
}
