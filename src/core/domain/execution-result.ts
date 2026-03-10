import type { ExecutionResultData } from '../contracts/execution.js';
import { SCHEMA_VERSIONS } from '../contracts/schema-versions.js';
import { cloneAndFreeze } from '../utils/immutability.js';

export type ExecutionResultInit = Omit<ExecutionResultData, 'schemaVersion'> | ExecutionResultData;

export class ExecutionResult {
  readonly schemaVersion = SCHEMA_VERSIONS.EXECUTION_RESULT;
  readonly output: string;
  readonly structuredOutput?: unknown;
  readonly trace?: ExecutionResultData['trace'];
  readonly metrics?: ExecutionResultData['metrics'];
  readonly outcome?: ExecutionResultData['outcome'];
  readonly error?: ExecutionResultData['error'];

  constructor(input: ExecutionResultInit) {
    this.output = input.output;

    if (input.structuredOutput !== undefined) {
      this.structuredOutput = cloneAndFreeze(input.structuredOutput);
    }
    if (input.trace !== undefined) {
      this.trace = cloneAndFreeze(input.trace);
    }
    if (input.metrics !== undefined) {
      this.metrics = cloneAndFreeze(input.metrics);
    }
    if (input.outcome !== undefined) {
      this.outcome = cloneAndFreeze(input.outcome);
    }
    if (input.error !== undefined) {
      this.error = cloneAndFreeze(input.error);
    }
  }

  static from(input: ExecutionResult | ExecutionResultData): ExecutionResult {
    return input instanceof ExecutionResult ? input : new ExecutionResult(input);
  }

  toRecord(): ExecutionResultData {
    return {
      schemaVersion: this.schemaVersion,
      output: this.output,
      ...(this.structuredOutput !== undefined ? { structuredOutput: this.structuredOutput } : {}),
      ...(this.trace !== undefined ? { trace: this.trace } : {}),
      ...(this.metrics !== undefined ? { metrics: this.metrics } : {}),
      ...(this.outcome !== undefined ? { outcome: this.outcome } : {}),
      ...(this.error !== undefined ? { error: this.error } : {}),
    };
  }
}
