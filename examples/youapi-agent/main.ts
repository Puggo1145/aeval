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

  const graders = new Graders();
  registerBuiltinGraders(graders);
  const builtinLlmJudgeProvider = new BuiltinLlmJudgeProvider({ env: process.env });
  graders.register(
    new LlmJudgeGrader(builtinLlmJudgeProvider, {
      validateConfig: (config) => new BuiltinLlmJudgeConfigValidator(process.env).validate(config),
    }),
  );

  const providers = new Providers();
  providers.register(new YouapiAgentProvider());

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
