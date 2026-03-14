import assert from 'node:assert/strict';
import test from 'node:test';
import { YouapiAgentProvider } from '../examples/youapi-agent/provider.ts';
import type { Run, TaskContext } from '../packages/core/src/core/contracts/runtime.js';

function createTaskContext(): TaskContext {
  return {
    taskId: 'youapi-agent/task-001-chat-smoke',
    trialIndex: 0,
    runName: 'agent-can-respond',
    runId: 'run-001',
    signal: new AbortController().signal,
  };
}

function createRun(params: Readonly<Record<string, unknown>>): Run {
  return {
    name: 'agent-can-respond',
    params,
  };
}

test('YouapiAgentProvider forwards optional chatModel to eval agent payload', async () => {
  const originalBaseUrl = process.env.YOUAPI_BASE_URL;
  const originalSecret = process.env.EVAL_API_SECRET;
  const originalFetch = globalThis.fetch;
  const provider = new YouapiAgentProvider();
  let requestBody: unknown;

  process.env.YOUAPI_BASE_URL = 'https://example.test';
  process.env.EVAL_API_SECRET = 'secret';

  globalThis.fetch = async (_input, init) => {
    requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;

    return new Response(
      JSON.stringify({
        output: 'ok',
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    );
  };

  try {
    const result = await provider.execute(
      createTaskContext(),
      createRun({
        userId: 'user-1',
        spaceId: 'space-1',
        boardId: 'board-1',
        prompt: 'hello',
        messageMode: 'agent',
        chatModel: 'gpt-5-mini',
      }),
    );

    assert.equal(result.output, 'ok');
    assert.deepEqual(requestBody, {
      userId: 'user-1',
      spaceId: 'space-1',
      boardId: 'board-1',
      prompt: 'hello',
      messageMode: 'agent',
      chatModel: 'gpt-5-mini',
    });
  } finally {
    globalThis.fetch = originalFetch;

    if (originalBaseUrl === undefined) {
      delete process.env.YOUAPI_BASE_URL;
    } else {
      process.env.YOUAPI_BASE_URL = originalBaseUrl;
    }

    if (originalSecret === undefined) {
      delete process.env.EVAL_API_SECRET;
    } else {
      process.env.EVAL_API_SECRET = originalSecret;
    }
  }
});
