const RUN_PROGRESS_BAR_WIDTH = 24;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const ANSI_GREEN = '\x1b[32m';
const ANSI_MAGENTA = '\x1b[35m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

export type RunPanelIndicatorState = 'pending' | 'running' | 'completed';

export function formatProgressBar(completed: number, total: number): string {
  const safeTotal = Math.max(total, 1);
  const clampedCompleted = Math.max(0, Math.min(completed, safeTotal));
  const ratio = clampedCompleted / safeTotal;
  const filled = Math.round(ratio * RUN_PROGRESS_BAR_WIDTH);
  const empty = Math.max(0, RUN_PROGRESS_BAR_WIDTH - filled);
  const filledBar = '━'.repeat(filled);
  const remainingBar = '━'.repeat(empty);
  return `${ANSI_MAGENTA}${filledBar}${ANSI_RESET}${ANSI_DIM}${remainingBar}${ANSI_RESET} ${clampedCompleted}/${total} trials`;
}

export function formatTaskRunHeader(input: {
  taskId: string;
  runName: string;
  completedTrials: number;
  totalTrials: number;
  indicatorState: RunPanelIndicatorState;
  spinnerFrameIndex: number;
}): string {
  const indicator = formatIndicator(input.indicatorState, input.spinnerFrameIndex);
  const progressBar = formatProgressBar(input.completedTrials, input.totalTrials);
  return `${input.taskId} · ${input.runName}  ${indicator} ${progressBar}`;
}

function formatIndicator(state: RunPanelIndicatorState, spinnerFrameIndex: number): string {
  if (state === 'completed') {
    return `${ANSI_GREEN}✓${ANSI_RESET}`;
  }

  if (state === 'running') {
    const frame = SPINNER_FRAMES[spinnerFrameIndex % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
    return `${ANSI_MAGENTA}${frame}${ANSI_RESET}`;
  }

  return `${ANSI_DIM}○${ANSI_RESET}`;
}

export function getSpinnerFrameCount(): number {
  return SPINNER_FRAMES.length;
}
