import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createConsoleObserverAdapter,
  createCore,
  createLocalResultStoreAdapter,
  createLocalTaskSourceAdapter,
  InMemoryGraderRegistry,
  InMemoryProviderRegistry,
  registerBuiltinGraders,
  runTui,
} from 'youeval';
import { basicLlmProvider, fileEditAgentProvider } from './providers/index.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));

function tryLoadEnvFile(): void {
  if (process.env.OPENAI_API_KEY) return;
  const envPath = resolve(currentDir, '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn(`[file-edit-agent] Failed to load .env file: ${message}`);
  }
}

async function main(): Promise<void> {
  tryLoadEnvFile();

  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('file-edit-agent', fileEditAgentProvider);
  providerRegistry.register('basic-llm', basicLlmProvider);

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
