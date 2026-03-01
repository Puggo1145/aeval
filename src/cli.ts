import { createAppCore } from './bootstrap/create-app-core.js';
import type { CoreApi } from './core/api/index.js';
import { BaseYouEvalError, ValidationError } from './core/errors/index.js';
import { runCli } from './interfaces/cli/index.js';

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

function readDatasetsRootFromEnv(): string {
  const value = process.env.YOUEVAL_DATASETS_ROOT;
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  throw new ValidationError("Missing required environment variable 'YOUEVAL_DATASETS_ROOT'.", {
    details: {
      field: 'YOUEVAL_DATASETS_ROOT',
    },
  });
}

function createLazyCore(): CoreApi {
  let core: CoreApi | null = null;

  const getCore = (): CoreApi => {
    if (core) {
      return core;
    }

    core = createAppCore({
      datasetsRoot: readDatasetsRootFromEnv(),
    });
    return core;
  };

  return {
    runExperiment(input) {
      return getCore().runExperiment(input);
    },
    streamRun(input) {
      return getCore().streamRun(input);
    },
    getRunSummary(runId) {
      return getCore().getRunSummary(runId);
    },
    listTrials(runId) {
      return getCore().listTrials(runId);
    },
    setBaseline(runId) {
      return getCore().setBaseline(runId);
    },
    compareBaseline(currentRunId, options) {
      return getCore().compareBaseline(currentRunId, options);
    },
  };
}

async function main(): Promise<void> {
  try {
    const core = createLazyCore();
    const exitCode = await runCli(process.argv.slice(2), core);
    process.exitCode = exitCode;
  } catch (error) {
    reportError(error);
    process.exitCode = 1;
  }
}

void main();
