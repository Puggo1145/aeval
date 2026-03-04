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
import { basicLlmProvider } from './provider.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  // 1. 创建评测任务数据源
  const taskSourceAdapter = createLocalTaskSourceAdapter({
    datasetsRoot: currentDir,
    dataset: 'datasets',
  });

  // 2. 创建评测结果存储适配器
  const resultStoreAdapter = createLocalResultStoreAdapter({
    rootDir: resolve(currentDir, 'results'),
  });

  // 3. 注册需要的评测器
  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  // 4. 创建评测器注册表
  const providerRegistry = new InMemoryProviderRegistry();
  providerRegistry.register('basic-llm', basicLlmProvider);

  const core = createCore({
    taskSourceAdapters: { local: taskSourceAdapter },
    resultStoreAdapters: { local: resultStoreAdapter },
    providerRegistry,
    graderRegistry,
    observerAdapters: {
      console: createConsoleObserverAdapter(),
    },
  });
  await runTui(core);
}

void main();
