import * as p from '@clack/prompts';

import type { CoreApi } from '../../index.js';

import { clearResults } from './actions/clear-results.js';
import { compareBaseline } from './actions/compare-baseline.js';
import { listRuns } from './actions/list-runs.js';
import { runTask } from './actions/run-task.js';
import { setBaseline } from './actions/set-baseline.js';
import { viewReport } from './actions/view-report.js';
import { viewTrials } from './actions/view-trials.js';
import { CancelError } from './utils.js';

type Action = (core: CoreApi) => Promise<void>;
const TUI_TITLE = 'YouEval — Interactive Mode';
const ACTION_CANCELLED_MESSAGE = 'Action cancelled.';
// 取消后短暂等待，避免残留的 ESC 按键被下一个 clack prompt 误读为取消操作
const CARRY_OVER_CANCEL_WINDOW_MS = 200;

const ACTIONS: Record<string, Action> = {
  run: (core) => runTask(core),
  report: (core) => viewReport(core),
  runs: (core) => listRuns(core),
  trials: (core) => viewTrials(core),
  'baseline-set': (core) => setBaseline(core),
  'baseline-compare': (core) => compareBaseline(core),
  'clear-selected-results': (core) => clearResults(core, 'selected'),
  'clear-all-results': (core) => clearResults(core, 'all'),
};

type GroupId = 'suite' | 'results' | 'baseline' | 'manage';
type ActionId = keyof typeof ACTIONS;

interface ActionOption {
  value: ActionId;
  label: string;
  hint?: string;
}

interface ActionGroup {
  id: GroupId;
  label: string;
  actions: ActionOption[];
}

const ACTION_GROUPS: ActionGroup[] = [
  {
    id: 'suite',
    label: 'Suite',
    actions: [{ value: 'run', label: 'Run a task' }],
  },
  {
    id: 'results',
    label: 'Results',
    actions: [
      { value: 'runs', label: 'List all runs' },
      { value: 'report', label: 'View run report' },
      { value: 'trials', label: 'View trial details' },
    ],
  },
  {
    id: 'baseline',
    label: 'Baseline',
    actions: [
      { value: 'baseline-set', label: 'Set baseline' },
      { value: 'baseline-compare', label: 'Compare with baseline' },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    actions: [
      { value: 'clear-selected-results', label: 'Delete selected results (destructive)' },
      { value: 'clear-all-results', label: 'Clear all results (destructive)' },
    ],
  },
];

const GROUP_PROMPTS = [
  'What do you want to evaluate today?',
  'Pick your next move, Judge.',
  "Time to run some suites. What's first?",
  'What shall we test-drive now?',
];

function pickRandomGroupPrompt(): string {
  return GROUP_PROMPTS[Math.floor(Math.random() * GROUP_PROMPTS.length)] ?? 'Choose an action:';
}

function redrawScreen(): void {
  process.stdout.write('\x1Bc');
  p.intro(TUI_TITLE);
}

export async function runTui(core: CoreApi): Promise<void> {
  let selectedGroupId: GroupId | undefined = ACTION_GROUPS[0]?.id;
  const selectedActionByGroup = new Map<GroupId, ActionId>();
  const groupPrompt = pickRandomGroupPrompt();
  let shouldRedrawGroupScreen = true;
  let running = true;

  while (running) {
    if (shouldRedrawGroupScreen) {
      redrawScreen();
    }

    const groupSelection: GroupId | 'exit' | symbol = (await p.select<GroupId | 'exit'>({
      message: groupPrompt,
      options: [
        ...ACTION_GROUPS.map((group) => ({
          value: group.id,
          label: group.label,
        })),
        { value: 'exit', label: 'Exit' },
      ],
      initialValue: selectedGroupId,
    })) as GroupId | 'exit' | symbol;

    if (p.isCancel(groupSelection) || groupSelection === 'exit') {
      running = false;
      break;
    }

    const groupId: GroupId = groupSelection;
    selectedGroupId = groupId;
    const group = ACTION_GROUPS.find((candidate) => candidate.id === groupId);
    if (!group) {
      shouldRedrawGroupScreen = true;
      continue;
    }

    redrawScreen();

    if (groupId === 'results') {
      const s = p.spinner();
      s.start('Loading runs…');
      const records = await core.listRuns();
      s.stop('Runs loaded.');

      if (records.length === 0) {
        p.log.warn('No runs found.');
        shouldRedrawGroupScreen = false;
        continue;
      }
    }

    const actionSelection: ActionId | 'back' | symbol = (await p.select<ActionId | 'back'>({
      message: `${group.label}: choose an action (Esc to go back)`,
      options: [
        ...group.actions.map((action) => ({
          value: action.value,
          label: action.label,
          hint: action.hint,
        })),
        { value: 'back', label: 'Back' },
      ],
      initialValue: selectedActionByGroup.get(groupId),
    })) as ActionId | 'back' | symbol;

    if (p.isCancel(actionSelection) || actionSelection === 'back') {
      shouldRedrawGroupScreen = true;
      continue;
    }

    const selectedAction: ActionId = actionSelection;
    selectedActionByGroup.set(groupId, selectedAction);

    const handler = ACTIONS[selectedAction];
    let actionCompletedMessage = 'Action completed.';
    if (handler) {
      try {
        await handler(core);
      } catch (error) {
        if (error instanceof CancelError) {
          actionCompletedMessage = ACTION_CANCELLED_MESSAGE;
        } else {
          const message = error instanceof Error ? error.message : String(error);
          p.log.error(message);
        }
      }
    }

    if (actionCompletedMessage === ACTION_CANCELLED_MESSAGE) {
      await new Promise((resolve) => setTimeout(resolve, CARRY_OVER_CANCEL_WINDOW_MS));
    }

    const backSelection: 'back' | symbol = (await p.select<'back'>({
      message: actionCompletedMessage,
      options: [{ value: 'back', label: 'Back' }],
      initialValue: 'back',
    })) as 'back' | symbol;

    if (p.isCancel(backSelection) || backSelection === 'back') {
      shouldRedrawGroupScreen = true;
    }
  }

  p.outro('Goodbye!');
}
