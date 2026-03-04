import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { type ExecutionResult, SCHEMA_VERSIONS, type TaskContext } from 'youeval';
import { runReActAgent } from './react-agent/index.ts';

function getStringParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = params[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function getStringParamFromSources(
  overrides: Readonly<Record<string, unknown>>,
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  return getStringParam(overrides, key) ?? getStringParam(params, key);
}

function toSystemError(message: string): ExecutionResult {
  return {
    schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
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
export async function fileEditAgentProvider(
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>,
): Promise<ExecutionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return toSystemError('Missing OPENAI_API_KEY environment variable.');
  }

  const model = getStringParamFromSources(ctx.overrides, params, 'model') ?? 'gpt-4o-mini';
  const task = getStringParamFromSources(ctx.overrides, params, 'task');
  if (!task) {
    return toSystemError("Provider param 'task' must be a non-empty string.");
  }

  const setup = params.setup as Record<string, string> | undefined;
  const outcomePaths = params.outcomePaths as string[] | undefined;

  // Isolated temp directory for this trial
  const workdir = join(tmpdir(), `youeval-file-agent-${randomUUID()}`);
  mkdirSync(workdir, { recursive: true });

  try {
    // Populate initial file system state
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

    // Capture outcome: read specified files back from workdir
    const outcome: Record<string, unknown> = {};
    if (outcomePaths) {
      for (const filePath of outcomePaths) {
        const fullPath = join(workdir, filePath);
        // Trim trailing whitespace to avoid newline-sensitivity in graders
        outcome[filePath] = existsSync(fullPath) ? readFileSync(fullPath, 'utf-8').trimEnd() : null;
      }
    }

    return {
      schemaVersion: SCHEMA_VERSIONS.EXECUTION_RESULT,
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
    // Best-effort cleanup of the temp workdir
    try {
      rmSync(workdir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
