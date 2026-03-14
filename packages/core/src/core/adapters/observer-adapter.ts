import type { RunEvent } from '../contracts/runtime.js';

export interface Observer {
  onEvent(event: RunEvent): Promise<void> | void;
}
