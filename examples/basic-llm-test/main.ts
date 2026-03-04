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
import { basicLlmProvider } from './provider.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));

function tryLoadEnvFile(): void {
  if (process.env.OPENAI_API_KEY) {
    return;
  }

  const envPath = resolve(currentDir, '.env');
  if (!existsSync(envPath)) {
    return;
  }

  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn(`[basic-llm-test] Failed to load .env file: ${message}`);
  }
}

async function main(): Promise<void> {
  tryLoadEnvFile();

  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('basic-llm', basicLlmProvider);

  const core = createCore({
    taskSourceAdapter: createLocalTaskSourceAdapter({
      datasetsRoot: currentDir,
      dataset: 'datasets',
    }),
    resultStoreAdapter: createLocalResultStoreAdapter({
      rootDir: resolve(currentDir, 'results'),
    }),
    providerRegistry,
    graderRegistry,
    observerAdapters: [createConsoleObserverAdapter()],
  });

  // 加载实验
  await core.loadExperiment(readFromYAML(resolve(currentDir, 'experiments/smoke.yaml')));

  // 交互模式
  await runTui(core);

  // 编程式用法：
  // const summary = await smoke.run('smoke');
  // console.log(`Done! passRate=${summary.passRate}`);
}

void main();
