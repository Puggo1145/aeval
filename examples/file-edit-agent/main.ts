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
  readFromYAML,
  registerBuiltinGraders,
  runTui,
} from 'youeval';
import { fileEditAgentProvider } from './provider.ts';

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

  const core = createCore({
    taskSourceAdapter: createLocalTaskSourceAdapter({
      datasetsRoot: currentDir,
    }),
    resultStoreAdapter: createLocalResultStoreAdapter({
      rootDir: resolve(currentDir, 'results'),
    }),
    providerRegistry,
    graderRegistry,
    observerAdapters: [createConsoleObserverAdapter()],
  });

  await core.loadExperiment(readFromYAML(resolve(currentDir, 'experiments/mini-models.yaml')));

  await runTui(core);
}

void main();
