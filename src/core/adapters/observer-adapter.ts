import type { RunEvent } from '../domain/run-event.js';

export interface Observer {
  onEvent(event: RunEvent): Promise<void> | void;
}
