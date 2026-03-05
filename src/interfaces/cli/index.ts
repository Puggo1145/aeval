import type { CoreApi } from '../../core/api/index.js';
import type { RunSummary } from '../../core/contracts/run-summary.js';
import type { BaselineComparison } from '../../core/contracts/runtime.js';
import { ERROR_CODES, ValidationError } from '../../core/errors/index.js';
import { readFromYAML } from '../../core/experiment/index.js';
import { readRunExperiment, readRunExperiments } from './run-metadata.js';

const KNOWN_COMMANDS = ['run', 'report', 'runs', 'trials', 'baseline'] as const;
type KnownCommand = (typeof KNOWN_COMMANDS)[number];
type CliCommandHandler = (args: string[], core: CoreApi) => Promise<number>;

function printHelp(): void {
  console.log(
    `YouEval CLI\n\nUsage:\n  youeval <command> [options]\n\nCommands:\n  run       Run an experiment\n  report    Show run summary\n  runs      List runs\n  trials    List trials\n  baseline  Manage baselines\n\nOptions:\n  -h, --help  Show help\n`,
  );
}

function isKnownCommand(command: string): command is KnownCommand {
  return KNOWN_COMMANDS.includes(command as KnownCommand);
}

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ValidationError(`Flag '${flag}' requires a value.`, {
      details: { flag },
    });
  }

  return value;
}

function parseNonNegativeNumberFlag(args: string[], flag: string): number | undefined {
  const raw = parseFlag(args, flag);
  if (raw === undefined) {
    return undefined;
  }

  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }

  throw new ValidationError(`Flag '${flag}' must be a non-negative finite number.`, {
    details: { flag, value: raw },
  });
}

function parseBooleanFlag(args: string[], flag: string): boolean | undefined {
  const raw = parseFlag(args, flag);
  if (raw === undefined) {
    return undefined;
  }

  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }

  throw new ValidationError(`Flag '${flag}' must be either 'true' or 'false'.`, {
    details: { flag, value: raw },
  });
}

function formatPassRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatExperiment(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return 'unknown';
  }
  return value.trim();
}

function printSummary(summary: RunSummary, experiment?: string): void {
  console.log(`Run: ${summary.runId} (${summary.runName})`);
  console.log(`  Experiment:   ${formatExperiment(experiment)}`);
  console.log(`  Pass Rate:    ${formatPassRate(summary.passRate)}`);
  console.log(`  Total Tasks:  ${summary.totalTasks}`);
  console.log(`  Total Trials: ${summary.totalTrials}`);
  if (summary.passAtK !== undefined) {
    console.log(`  Pass@K:       ${formatPassRate(summary.passAtK)}`);
  }
  if (summary.passHatK !== undefined) {
    console.log(`  Pass^K:       ${formatPassRate(summary.passHatK)}`);
  }
  if (summary.avgLatencyMs !== undefined) {
    console.log(`  Avg Latency:  ${summary.avgLatencyMs.toFixed(0)}ms`);
  }
}

function printComparison(comparison: BaselineComparison): void {
  console.log(`Baseline: ${comparison.baselineRunId} → Current: ${comparison.currentRunId}`);
  console.log(`  Verdict:         ${comparison.verdict}`);
  console.log(
    `  Pass Rate Delta: ${comparison.passRateDelta >= 0 ? '+' : ''}${formatPassRate(comparison.passRateDelta)}`,
  );
  if (comparison.passHatKDelta !== undefined) {
    console.log(
      `  Pass^K Delta:    ${comparison.passHatKDelta >= 0 ? '+' : ''}${formatPassRate(comparison.passHatKDelta)}`,
    );
  }
  if (comparison.avgLatencyDelta !== undefined) {
    console.log(
      `  Latency Delta:   ${comparison.avgLatencyDelta >= 0 ? '+' : ''}${comparison.avgLatencyDelta.toFixed(0)}ms`,
    );
  }
  if (comparison.regressions.length > 0) {
    console.log(`  Regressions:     ${comparison.regressions.join(', ')}`);
  }
  if (comparison.improvements.length > 0) {
    console.log(`  Improvements:    ${comparison.improvements.join(', ')}`);
  }
}

const handleRun: CliCommandHandler = async (args, core) => {
  const experimentPath = parseFlag(args, '--experiment');
  const runName = parseFlag(args, '--run');

  if (!experimentPath) {
    throw new ValidationError("Missing required flag '--experiment'.", {
      details: { flag: '--experiment' },
    });
  }
  if (!runName) {
    throw new ValidationError("Missing required flag '--run'.", {
      details: { flag: '--run' },
    });
  }

  const experiment = await core.loadExperiment(readFromYAML(experimentPath));

  let lastSummary: RunSummary | undefined;
  for await (const event of experiment.stream(runName)) {
    switch (event.type) {
      case 'run:started':
        console.log(`Run started: ${event.runId} (${event.totalTasks} tasks)`);
        break;
      case 'trial:started':
        console.log(`  Trial started: ${event.taskId} #${event.trialIndex}`);
        break;
      case 'trial:completed':
        console.log(
          `  Trial completed: ${event.taskId} #${event.trialIndex} ${event.pass ? 'PASS' : 'FAIL'} (${event.durationMs}ms)`,
        );
        break;
      case 'trial:error':
        console.error(
          `  Trial error: ${event.taskId} #${event.trialIndex} [${event.errorType}] ${event.message}`,
        );
        break;
      case 'run:completed':
        lastSummary = event.summary;
        break;
    }
  }

  if (lastSummary) {
    const experiment = await readRunExperiment(core, lastSummary.runId);
    console.log('');
    printSummary(lastSummary, experiment);
  }

  return 0;
};

const handleReport: CliCommandHandler = async (args, core) => {
  const runId = args[0];
  if (!runId) {
    throw new ValidationError('Missing required argument <runId>.', {
      details: { usage: 'youeval report <runId>' },
    });
  }

  const summary = await core.getRunSummary(runId);
  if (!summary) {
    console.error(`Run '${runId}' not found.`);
    return 1;
  }

  const experiment = await readRunExperiment(core, runId);
  printSummary(summary, experiment);
  return 0;
};

const handleRuns: CliCommandHandler = async (_args, core) => {
  const records = await core.listRuns();

  if (records.length === 0) {
    console.log('No runs found.');
    return 0;
  }

  const experiments = await readRunExperiments(
    core,
    records.map((record) => record.runId),
  );
  const header = ['Run ID', 'Experiment', 'Run Name', 'Pass Rate', 'Tasks', 'Trials'];
  const rows = records.map((r) => [
    r.summary.runId,
    formatExperiment(experiments.get(r.runId)),
    r.summary.runName,
    formatPassRate(r.summary.passRate),
    String(r.summary.totalTasks),
    String(r.summary.totalTrials),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length)),
  );

  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ');

  console.log(formatRow(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(formatRow(row));
  }

  return 0;
};

const handleTrials: CliCommandHandler = async (args, core) => {
  const runId = args[0];
  if (!runId) {
    throw new ValidationError('Missing required argument <runId>.', {
      details: { usage: 'youeval trials <runId>' },
    });
  }

  const experiment = await readRunExperiment(core, runId);
  console.log(`Experiment: ${formatExperiment(experiment)}`);

  const trials = await core.listTrials(runId);

  if (trials.length === 0) {
    console.log(`No trials found for run '${runId}'.`);
    return 0;
  }

  for (const record of trials) {
    const t = record.trial;
    const score = t.aggregate.score !== undefined ? t.aggregate.score.toFixed(2) : '-';
    console.log(
      `  ${t.taskId} #${t.trialIndex}  ${t.aggregate.pass ? 'PASS' : 'FAIL'}  score=${score}  ${t.timings.durationMs}ms`,
    );

    if (t.graderResults.length === 0) {
      console.log('    - (no grader results)');
      continue;
    }

    for (const grader of t.graderResults) {
      const graderScore = grader.result.score !== undefined ? grader.result.score.toFixed(2) : '-';
      console.log(
        `    - [${grader.result.pass ? 'PASS' : 'FAIL'}] ${grader.name} (${grader.type}) score=${graderScore} reason=${grader.result.reason}`,
      );
    }
  }

  return 0;
};

const handleBaseline: CliCommandHandler = async (args, core) => {
  const subcommand = args[0];

  if (subcommand === 'set') {
    const runId = args[1];
    if (!runId) {
      throw new ValidationError('Missing required argument <runId>.', {
        details: { usage: 'youeval baseline set <runId>' },
      });
    }
    await core.setBaseline(runId);
    console.log(`Baseline set to run '${runId}'.`);
    return 0;
  }

  if (subcommand === 'compare') {
    const runId = args[1];
    if (!runId) {
      throw new ValidationError('Missing required argument <runId>.', {
        details: { usage: 'youeval baseline compare <runId>' },
      });
    }

    const baselineRunId = parseFlag(args, '--baseline');
    const passRateDrop = parseNonNegativeNumberFlag(args, '--pass-rate-drop');
    const passHatKDrop = parseNonNegativeNumberFlag(args, '--pass-hat-k-drop');
    const avgLatencyIncrease = parseNonNegativeNumberFlag(args, '--avg-latency-increase');
    const tokenBudgetBreached = parseBooleanFlag(args, '--token-budget-breached');

    const hasThreshold =
      passRateDrop !== undefined || passHatKDrop !== undefined || avgLatencyIncrease !== undefined;

    const comparison = await core.compareBaseline(runId, {
      baselineRunId,
      thresholds: hasThreshold
        ? {
            passRateDrop,
            passHatKDrop,
            avgLatencyIncrease,
          }
        : undefined,
      tokenBudgetBreached,
    });
    printComparison(comparison);
    return 0;
  }

  throw new ValidationError(
    `Unknown baseline subcommand '${subcommand ?? ''}'. Use 'set' or 'compare'.`,
    {
      details: { subcommand, usage: 'youeval baseline set|compare <runId>' },
    },
  );
};

const COMMAND_HANDLERS: Record<KnownCommand, CliCommandHandler> = {
  run: handleRun,
  report: handleReport,
  runs: handleRuns,
  trials: handleTrials,
  baseline: handleBaseline,
};

export async function runCli(args: string[], core: CoreApi): Promise<number> {
  if (args.length === 0) {
    printHelp();
    return 0;
  }

  const command = args[0];
  if (!command) {
    printHelp();
    return 0;
  }

  if (command === '-h' || command === '--help') {
    printHelp();
    return 0;
  }

  if (isKnownCommand(command)) {
    return COMMAND_HANDLERS[command](args.slice(1), core);
  }

  throw new ValidationError(`Unknown command '${command}'.`, {
    code: ERROR_CODES.VALIDATION_UNKNOWN_COMMAND,
    details: { command, knownCommands: [...KNOWN_COMMANDS] },
  });
}

export { runTui } from './tui/index.js';
