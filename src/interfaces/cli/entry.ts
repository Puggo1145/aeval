import { createAppCore } from '../../bootstrap/create-app-core.js';
import { BaseYouEvalError } from '../../core/errors/index.js';
import { runCli } from './index.js';

function formatDetails(details: Record<string, unknown>): string {
  try {
    return JSON.stringify(details);
  } catch {
    return '[unserializable details]';
  }
}

function reportError(error: unknown): void {
  if (error instanceof BaseYouEvalError) {
    console.error(`[${error.category}:${error.code}] ${error.message}`);
    if (error.details) {
      console.error(`Details: ${formatDetails(error.details)}`);
    }
    return;
  }

  if (error instanceof Error) {
    console.error(`[unknown:UNEXPECTED] ${error.message}`);
    return;
  }

  console.error('[unknown:UNEXPECTED] A non-error value was thrown.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  try {
    const core = createAppCore();
    const exitCode = await runCli(args, core);
    process.exitCode = exitCode;
  } catch (error) {
    reportError(error);
    process.exitCode = 1;
  }
}

void main();
