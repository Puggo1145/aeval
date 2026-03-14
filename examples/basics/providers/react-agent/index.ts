import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolCallRecord, TurnRecord } from '@youeval/core';
import { generateText, type LanguageModel, type ModelMessage, tool } from 'ai';
import { z } from 'zod';

const SYSTEM_PROMPT = `You are a file editing agent with access to a working directory.
Think step by step. Use the available tools to complete the task.
When you are done, provide a brief summary of what you did.`;

export interface ReActAgentConfig {
  model: LanguageModel;
  task: string;
  workdir: string;
  maxSteps?: number;
  signal?: AbortSignal;
}

export interface ReActAgentResult {
  output: string;
  turns: TurnRecord[];
  tokenUsage: { input: number; output: number; total: number };
  steps: number;
}

function makeTools(workdir: string) {
  return {
    read_file: tool({
      description: 'Read the content of a file in the working directory.',
      inputSchema: z.object({
        path: z.string().describe('Relative path within the working directory'),
      }),
      execute: async ({ path }: { path: string }) => {
        const fullPath = join(workdir, path);
        if (!existsSync(fullPath)) return `Error: "${path}" does not exist.`;
        try {
          return readFileSync(fullPath, 'utf-8');
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
    write_file: tool({
      description:
        'Write content to a file in the working directory. Creates the file if it does not exist, overwrites if it does.',
      inputSchema: z.object({
        path: z.string().describe('Relative path within the working directory'),
        content: z.string().describe('Full content to write to the file'),
      }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        const fullPath = join(workdir, path);
        try {
          writeFileSync(fullPath, content, 'utf-8');
          return `"${path}" written successfully (${content.length} chars).`;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
    list_files: tool({
      description: 'List all files in the working directory.',
      inputSchema: z.object({}),
      execute: async (_input: Record<string, never>) => {
        try {
          const files = readdirSync(workdir);
          return files.length > 0 ? files.join('\n') : '(empty directory)';
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
  };
}

/**
 * Minimal ReAct agent loop.
 *
 * Each iteration:
 *   1. Call the LLM (one step, toolChoice: 'auto')
 *   2. If tool calls → execute them, append messages, continue
 *   3. If no tool calls → LLM has finished, return its text as output
 */
export async function runReActAgent(config: ReActAgentConfig): Promise<ReActAgentResult> {
  const maxSteps = config.maxSteps ?? 10;
  const tools = makeTools(config.workdir);

  const messages: ModelMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: config.task },
  ];

  const turns: TurnRecord[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: config.task },
  ];

  let totalInput = 0;
  let totalOutput = 0;
  let finalOutput = '';
  let completedSteps = 0;

  for (let step = 0; step < maxSteps; step++) {
    completedSteps = step + 1;

    const result = await generateText({
      model: config.model,
      messages,
      tools,
      toolChoice: 'auto',
      abortSignal: config.signal,
    });

    totalInput += result.usage.inputTokens ?? 0;
    totalOutput += result.usage.outputTokens ?? 0;

    // Build tool call records (params from toolCalls, result from toolResults)
    const toolCallRecords: ToolCallRecord[] = result.toolCalls.map((tc, i) => ({
      tool: tc.toolName,
      params: (tc as { input: Record<string, unknown> }).input,
      // toolResults is ordered the same as toolCalls when all tools have execute
      result: (result.toolResults as Array<{ output: unknown }>)[i]?.output,
    }));

    turns.push({
      role: 'assistant',
      content: result.text,
      ...(toolCallRecords.length > 0 ? { toolCalls: toolCallRecords } : {}),
    });

    // No tool calls → LLM is done
    if (result.toolCalls.length === 0) {
      finalOutput = result.text;
      break;
    }

    // Append the assistant message + tool result messages for the next iteration
    messages.push(...(result.response.messages as ModelMessage[]));

    if (step === maxSteps - 1) {
      finalOutput = result.text || '(max steps reached without final answer)';
    }
  }

  return {
    output: finalOutput,
    turns,
    tokenUsage: {
      input: totalInput,
      output: totalOutput,
      total: totalInput + totalOutput,
    },
    steps: completedSteps,
  };
}
