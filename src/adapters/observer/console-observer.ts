import type { Observer, RunEvent } from '../../index.js';

export class ConsoleObserver implements Observer {
  onEvent(event: RunEvent): void {
    if (event.type === 'run:started') {
      console.log(
        `[run:started] task=${event.taskId} run=${event.runName} trials=${event.totalTrials}`,
      );
      return;
    }

    if (event.type === 'trial:started') {
      console.log(
        `[trial:started] task=${event.taskId} run=${event.runName} trial=${event.trialIndex}`,
      );
      return;
    }

    if (event.type === 'trial:completed') {
      console.log(
        `[trial:completed] task=${event.taskId} run=${event.runName} trial=${event.trialIndex} pass=${event.pass} durationMs=${event.durationMs}`,
      );
      return;
    }

    if (event.type === 'trial:error') {
      console.error(
        `[trial:error] task=${event.taskId} run=${event.runName} trial=${event.trialIndex} type=${event.errorType} message=${event.message}`,
      );
      return;
    }

    if (event.type === 'run:completed') {
      console.log(
        `[run:completed] task=${event.summary.taskId} run=${event.summary.runName} passRate=${event.summary.passRate} totalTrials=${event.summary.totalTrials}`,
      );
    }
  }
}
