import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import {
  type ExecutionResultInput,
  type Provider,
  type Run,
  type TaskContext,
} from '@youmindinc/youeval-core';
import { runReActAgent } from './react-agent/index.ts';

function getStringParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toSystemError(message: string): ExecutionResultInput {
  return {
    output: '',
    error: { type: 'system', message },
  };
}

/**
 * Provider that runs a ReAct file-editing agent.
 *
 * Task params:
 *   model        – OpenAI model name (default: gpt-4o-mini)
 *   task         – Natural-language instruction for the agent
 *   setup        – Optional Record<filename, content> to pre-populate the workdir
 *   outcomePaths – Optional string[] of file paths to capture into ExecutionResult.outcome
 */
export class FileEditAgentProvider implements Provider {
  readonly id = 'file-edit-agent';

  async execute(ctx: TaskContext, run: Run): Promise<ExecutionResultInput> {
    const params = run.params;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return toSystemError('Missing OPENAI_API_KEY environment variable.');
    }

    const model = getStringParam(params, 'model') ?? 'gpt-4o-mini';
    const task = getStringParam(params, 'task');
    if (!task) {
      return toSystemError("Provider param 'task' must be a non-empty string.");
    }

    const setup = params.setup as Record<string, string> | undefined;
    const outcomePaths = params.outcomePaths as string[] | undefined;

    const workdir = join(tmpdir(), `youeval-file-agent-${randomUUID()}`);
    mkdirSync(workdir, { recursive: true });

    try {
      if (setup) {
        for (const [filename, content] of Object.entries(setup)) {
          writeFileSync(join(workdir, filename), content, 'utf-8');
        }
      }

      const openai = createOpenAI({ apiKey });
      const startedAt = Date.now();

      const agentResult = await runReActAgent({
        model: openai(model),
        task,
        workdir,
        maxSteps: 10,
        signal: ctx.signal,
      });

      const latencyMs = Date.now() - startedAt;

      const outcome: Record<string, unknown> = {};
      if (outcomePaths) {
        for (const filePath of outcomePaths) {
          const fullPath = join(workdir, filePath);
          outcome[filePath] = existsSync(fullPath)
            ? readFileSync(fullPath, 'utf-8').trimEnd()
            : null;
        }
      }

      return {
        output: agentResult.output,
        trace: {
          turns: agentResult.turns,
        },
        metrics: {
          latencyMs,
          model,
          tokenUsage: agentResult.tokenUsage,
          agentSteps: agentResult.steps,
        },
        outcome: Object.keys(outcome).length > 0 ? outcome : undefined,
      };
    } catch (error) {
      if (ctx.signal.aborted) {
        return toSystemError('Agent execution aborted by timeout/cancellation.');
      }
      const message = error instanceof Error ? error.message : 'Unknown error.';
      return toSystemError(`Agent execution failed: ${message}`);
    } finally {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
