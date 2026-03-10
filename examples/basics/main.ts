import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BuiltinLlmJudgeConfigValidator,
  BuiltinLlmJudgeProvider,
  ConsoleObserver,
  Core,
  Graders,
  LlmJudgeGrader,
  LocalStore,
  LocalTask,
  Providers,
  registerBuiltinGraders,
  runTui,
} from 'youeval';
import { BasicLlmProvider, FileEditAgentProvider } from './providers/index.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));

function tryLoadEnvFile(): void {
  if (process.env.OPENAI_API_KEY && process.env.AIHUBMIX_API_KEY) return;
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

  const graders = new Graders();
  registerBuiltinGraders(graders);
  const builtinLlmJudgeProvider = new BuiltinLlmJudgeProvider({ env: process.env });
  graders.register(
    new LlmJudgeGrader(builtinLlmJudgeProvider, {
      validateConfig: (config) => new BuiltinLlmJudgeConfigValidator(process.env).validate(config),
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
