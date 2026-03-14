import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenAI } from '@ai-sdk/openai';
import { Core, Graders, Providers } from 'youeval';
import { ConsoleObserver, LocalStore, LocalTask } from 'youeval/adapters';
import { BuiltinLlmJudgeGrader, registerBuiltinGraders } from 'youeval/graders';
import { runTui } from 'youeval/interfaces/tui';
import { BasicLlmProvider, FileEditAgentProvider } from './providers/index.ts';

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
  const openai = createOpenAI({
    baseURL: 'https://aihubmix.com/v1',
    apiKey: process.env.AIHUBMIX_API_KEY,
  });

  const graders = new Graders();
  registerBuiltinGraders(graders);
  graders.register(
    new BuiltinLlmJudgeGrader({
      profiles: {
        default: openai('gpt-5.4'),
      },
    }),
  );

  const providers = new Providers();
  providers.register(new FileEditAgentProvider());
  providers.register(new BasicLlmProvider());

  const core = new Core({
    tasks: new LocalTask({
      rootDir: currentDir,
    }),
    stores: new LocalStore({
      rootDir: resolve(currentDir, 'results'),
    }),
    providers,
    graders,
    observers: [new ConsoleObserver()],
  });

  await runTui(core);
}

void main();
