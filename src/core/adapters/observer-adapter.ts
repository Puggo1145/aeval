import type { RunEvent } from '../contracts/runtime.js';

export interface ObserverAdapter {
  onEvent(event: RunEvent): Promise<void> | void;
}
