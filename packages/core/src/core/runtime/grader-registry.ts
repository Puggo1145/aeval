import type { Grader, Graders as GradersContract } from '../contracts/runtime.js';
import { KeyedRegistry } from './keyed-registry.js';

export class Graders extends KeyedRegistry<Grader> implements GradersContract {
  constructor() {
    super({ kind: 'Grader', idField: 'grader.type', detailsKey: 'type' });
  }

  protected keyOf(grader: Grader): string {
    return grader.type;
  }
}
