const STREAM_CLOSED_MESSAGE = 'stream closed';

export class StreamClosedError extends Error {
  constructor() {
    super(STREAM_CLOSED_MESSAGE);
    this.name = 'StreamClosedError';
  }
}

const TRIAL_TIMEOUT_ABORT_REASON = Symbol('trial-timeout');

export function createTrialTimeoutAbortReason(): symbol {
  return TRIAL_TIMEOUT_ABORT_REASON;
}

export function isTrialTimeoutAbortReason(reason: unknown): boolean {
  return reason === TRIAL_TIMEOUT_ABORT_REASON;
}

export function isStreamClosedError(reason: unknown): reason is StreamClosedError {
  return reason instanceof StreamClosedError;
}
