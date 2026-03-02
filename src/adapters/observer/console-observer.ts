import type { ObserverAdapter } from '../../core/adapters/observer-adapter.js';
import type { RunEvent } from '../../core/contracts/runtime.js';

export function createConsoleObserverAdapter(): ObserverAdapter {
  return {
    onEvent(event: RunEvent): void {
      switch (event.type) {
        case 'run:started':
          console.log(`[run:started] runId=${event.runId} tasks=${event.totalTasks}`);
          break;
        case 'trial:started':
          console.log(`[trial:started] taskId=${event.taskId} trial=${event.trialIndex}`);
          break;
        case 'trial:completed':
          console.log(
            `[trial:completed] taskId=${event.taskId} trial=${event.trialIndex} pass=${event.pass} durationMs=${event.durationMs}`,
          );
          break;
        case 'trial:error':
          console.error(
            `[trial:error] taskId=${event.taskId} trial=${event.trialIndex} errorType=${event.errorType} message=${event.message}`,
          );
          break;
        case 'run:completed':
          console.log(
            `[run:completed] passRate=${event.summary.passRate} totalTasks=${event.summary.totalTasks} totalTrials=${event.summary.totalTrials}`,
          );
          break;
      }
    },
  };
}
