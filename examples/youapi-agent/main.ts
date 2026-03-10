import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Core, Graders, Providers } from 'youeval';
import { ConsoleObserver, LocalStore, LocalTask } from 'youeval/adapters';
import { BuiltinLlmJudgeGrader, registerBuiltinGraders } from 'youeval/graders';
import { runTui } from 'youeval/interfaces/tui';
import { YouapiAgentProvider } from './provider.ts';

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

  // 谁来运行 youapi
  const providers = new Providers();
  providers.register(new YouapiAgentProvider());

  // 评分器
  const graders = new Graders();
  registerBuiltinGraders(graders);
  graders.register(new BuiltinLlmJudgeGrader({ env: process.env }));

  const core = new Core({
    // task 来源
    tasks: new LocalTask({
      rootDir: currentDir,
    }),
    // 结果怎么存
    stores: new LocalStore({
      rootDir: resolve(currentDir, 'results'),
    }),
    providers,
    graders,
    // optional。可以观测中间过程
    observers: [new ConsoleObserver()],
  });

  await runTui(core);
}

void main();
