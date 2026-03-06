import type { ObserverAdapter } from '../../core/adapters/observer-adapter.js';
import type { RunEvent } from '../../core/contracts/runtime.js';

export function createConsoleObserverAdapter(): ObserverAdapter {
  return {
    onEvent(event: RunEvent): void {
      switch (event.type) {
        case 'run:started':
          console.log(
            `[run:started] runId=${event.runId} taskId=${event.taskId} run=${event.runName} totalTrials=${event.totalTrials}`,
          );
          break;
        case 'trial:started':
          console.log(
            `[trial:started] taskId=${event.taskId} run=${event.runName} trial=${event.trialIndex}`,
          );
          break;
        case 'trial:completed':
          console.log(
            `[trial:completed] taskId=${event.taskId} run=${event.runName} trial=${event.trialIndex} pass=${event.pass} durationMs=${event.durationMs}`,
          );
          break;
        case 'trial:error':
          console.error(
            `[trial:error] taskId=${event.taskId} run=${event.runName} trial=${event.trialIndex} errorType=${event.errorType} message=${event.message}`,
          );
          break;
        case 'run:completed':
          console.log(
            `[run:completed] taskId=${event.summary.taskId} run=${event.summary.runName} passRate=${event.summary.passRate} totalTrials=${event.summary.totalTrials}`,
          );
          break;
      }
    },
  };
}
