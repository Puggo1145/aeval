import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBuiltinLlmJudgeProvider,
  createConsoleObserverAdapter,
  createCore,
  createLlmJudgeGrader,
  createLocalResultStoreAdapter,
  createLocalTaskSourceAdapter,
  InMemoryGraderRegistry,
  InMemoryProviderRegistry,
  registerBuiltinGraders,
  runTui,
} from 'youeval';
import { youapiAgentProvider } from './provider.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));

function tryLoadEnvFile(): void {
  const envPath = resolve(currentDir, '.env');
  if (!existsSync(envPath)) {
    return;
  }

  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn(`[youapi-agent] Failed to load .env file: ${message}`);
  }
}

async function main(): Promise<void> {
  tryLoadEnvFile();

  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);
  const builtinLlmJudgeProvider = createBuiltinLlmJudgeProvider({ env: process.env });
  graderRegistry.register('llm-judge', createLlmJudgeGrader(builtinLlmJudgeProvider));

  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('youapi-agent', youapiAgentProvider);

  const core = createCore({
    taskSourceAdapter: createLocalTaskSourceAdapter({
      rootDir: currentDir,
    }),
    resultStoreAdapter: createLocalResultStoreAdapter({
      rootDir: resolve(currentDir, 'results'),
    }),
    providerRegistry,
    graderRegistry,
    observerAdapters: [createConsoleObserverAdapter()],
  });

  await runTui(core);
}

void main();
