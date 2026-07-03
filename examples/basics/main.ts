import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConsoleObserver } from "@aeval/adapter-observer-console";
import { LocalStore } from "@aeval/adapter-result-store-local";
import { LocalTask } from "@aeval/adapter-task-source-local";
import { Core } from "@aeval/core";
import { BuiltinLlmJudgeGrader, builtinGraders } from "@aeval/graders";
import { runTui } from "@aeval/interface-tui";
import { createOpenAI } from "@ai-sdk/openai";
import { BasicLlmProvider, FileEditAgentProvider } from "./providers/index.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));

function tryLoadEnvFile(): void {
  if (process.env.DEEPSEEK_API_KEY) return;
  const envPath = resolve(currentDir, ".env");
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[file-edit-agent] Failed to load .env file: ${message}`);
  }
}

async function main(): Promise<void> {
  tryLoadEnvFile();
  const openai = createOpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });

  const core = new Core({
    tasks: new LocalTask({ rootDir: currentDir }),
    stores: new LocalStore({ rootDir: resolve(currentDir, "results") }),
    providers: [new FileEditAgentProvider(), new BasicLlmProvider()],
    graders: [
      ...builtinGraders,
      new BuiltinLlmJudgeGrader({
        profiles: {
          default: openai.chat("deepseek-v4-flash"),
        },
      }),
    ],
    observers: [new ConsoleObserver()],
    runtimeDefaults: {
      taskConcurrency: 4,
    },
  });

  await runTui(core);
}

void main();
