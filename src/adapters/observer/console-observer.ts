import type { Observer } from '../../core/adapters/observer-adapter.js';
import {
  RunCompletedEvent,
  type RunEvent,
  RunStartedEvent,
  TrialCompletedEvent,
  TrialErrorEvent,
  TrialStartedEvent,
} from '../../core/domain/run-event.js';

export class ConsoleObserver implements Observer {
  onEvent(event: RunEvent): void {
    if (event instanceof RunStartedEvent) {
      console.log(
        `[run:started] task=${event.taskId} run=${event.runName} trials=${event.totalTrials}`,
      );
      return;
    }

    if (event instanceof TrialStartedEvent) {
      console.log(
        `[trial:started] task=${event.taskId} run=${event.runName} trial=${event.trialIndex}`,
      );
      return;
    }

    if (event instanceof TrialCompletedEvent) {
      console.log(
        `[trial:completed] task=${event.taskId} run=${event.runName} trial=${event.trialIndex} pass=${event.pass} durationMs=${event.durationMs}`,
      );
      return;
    }

    if (event instanceof TrialErrorEvent) {
      console.error(
        `[trial:error] task=${event.taskId} run=${event.runName} trial=${event.trialIndex} type=${event.errorType} message=${event.message}`,
      );
      return;
    }

    if (event instanceof RunCompletedEvent) {
      console.log(
        `[run:completed] task=${event.summary.taskId} run=${event.summary.runName} passRate=${event.summary.passRate} totalTrials=${event.summary.totalTrials}`,
      );
    }
  }
}
