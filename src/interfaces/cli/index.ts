import type { CoreApi } from '../../core/api/index.js';
import { ERROR_CODES, RuntimeError, ValidationError } from '../../core/errors/index.js';

const KNOWN_COMMANDS = ['run', 'report', 'runs', 'trials', 'baseline'] as const;
type KnownCommand = (typeof KNOWN_COMMANDS)[number];
type CliCommandHandler = (args: string[], core: CoreApi) => Promise<number>;

function printHelp(): void {
  console.log(
    `YouEval CLI (Milestone 0)\n\nUsage:\n  youeval <command> [options]\n\nCommands:\n  run       Run an experiment (placeholder)\n  report    Show run summary (placeholder)\n  runs      List runs (placeholder)\n  trials    List trials (placeholder)\n  baseline  Manage baselines (placeholder)\n\nOptions:\n  -h, --help  Show help\n`,
  );
}

function isKnownCommand(command: string): command is KnownCommand {
  return KNOWN_COMMANDS.includes(command as KnownCommand);
}

function createNotImplementedHandler(command: KnownCommand): CliCommandHandler {
  return async () => {
    throw new RuntimeError(`Command '${command}' is not implemented yet.`, {
      code: ERROR_CODES.RUNTIME_NOT_IMPLEMENTED,
      details: { command },
    });
  };
}

const COMMAND_HANDLERS: Record<KnownCommand, CliCommandHandler> = {
  run: createNotImplementedHandler('run'),
  report: createNotImplementedHandler('report'),
  runs: createNotImplementedHandler('runs'),
  trials: createNotImplementedHandler('trials'),
  baseline: createNotImplementedHandler('baseline'),
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
