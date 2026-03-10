import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { LocalStore } from '../src/adapters/result-store/local-result-store-adapter.js';
import { LocalTask } from '../src/adapters/task-source/local-task-source-adapter.js';
import { Core } from '../src/core/api/index.js';
import type { RunEvent } from '../src/core/domain/run-event.js';
import { ExecutionResult } from '../src/core/domain/execution-result.js';
import { Graders, Providers } from '../src/core/runtime/index.js';
import { LlmJudgeGrader } from '../src/graders/llm/llm-judge.js';
import { registerBuiltinGraders } from '../src/graders/register-builtins.js';

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'youeval-e2e-'));
}

async function writeYaml(rootDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = join(rootDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

const SUITE_YAML = `schemaVersion: "suite.v1"
id: "basic-llm"
name: "Basic LLM"
discover:
  - "datasets/**/*.yaml"
`;

const TASK_YAML = `schemaVersion: "task.v1"
id: "basic-llm/task-001"
provider:
  id: "reference"
  runs:
    - name: "mini"
      params:
        output: "Paris"
    - name: "nano"
      params:
        output: "Paris"
graders:
  strategy: "ALL"
  layers:
    - name: "contains paris"
      type: "contains"
      config:
        mustInclude:
          - pattern: "Paris"
            caseSensitive: false
execution:
  timeoutMs: 1000
  retryOnError: 0
  trialsPerTask: 2
`;

const JUDGE_TASK_YAML = `schemaVersion: "task.v1"
id: "basic-llm/task-judge"
provider:
  id: "reference"
  runs:
    - name: "judge"
      params:
        output: "The capital is Paris."
graders:
  strategy: "ALL"
  layers:
    - name: "semantic judge"
      type: "llm-judge"
      config:
        dimension: "factuality"
        rubric: "Pass if the answer clearly states Paris is the capital of France."
        assertions:
          - "The answer states that Paris is the capital of France."
          - "The answer does not contradict the prompt."
        passThreshold: 1
        judge:
          provider: "aihubmix"
          model: "gpt-4.1-mini"
execution:
  timeoutMs: 1000
`;

test('E2E smoke: full chain from suite discovery to result-store readback', async () => {
  const workspace = await createWorkspace();
  try {
    await writeYaml(workspace, 'suites/basic.yaml', SUITE_YAML);
    await writeYaml(workspace, 'datasets/task-001.yaml', TASK_YAML);

    const providers = new Providers();
    providers.register({
      id: 'reference',
      async execute(_ctx, run) {
        return new ExecutionResult({
          output: String(run.params.output ?? ''),
          metrics: { latencyMs: 25 },
        });
      },
    });

    const graders = new Graders();
    registerBuiltinGraders(graders);

    const core = new Core({
      tasks: new LocalTask({ rootDir: workspace }),
      stores: new LocalStore({
        rootDir: join(workspace, 'results'),
      }),
      providers,
      graders,
    });

    const suite = await core.loadSuite('basic-llm');
    const events: RunEvent[] = [];
    for await (const event of suite.streamTask('basic-llm/task-001')) {
      events.push(event);
    }

    const summaries = events
      .filter((event): event is Extract<RunEvent, { type: 'run:completed' }> => event.type === 'run:completed')
      .map((event) => event.summary);

    assert.deepEqual(
      summaries.map((summary) => summary.runName),
      ['mini', 'nano'],
    );
    assert.ok(summaries.every((summary) => summary.passRate === 1));

    const runs = await core.listRuns();
    assert.equal(runs.length, 2);
    assert.ok(runs.every((run) => run.status === 'completed'));

    const manifest = await core.getRunManifest(runs[0]!.runId);
    assert.equal(manifest?.suiteId, 'basic-llm');
    assert.equal(manifest?.taskId, 'basic-llm/task-001');
    assert.ok(manifest?.taskHash);

    const trials = await core.listTrials(runs[0]!.runId);
    assert.equal(trials.length, 2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('E2E smoke: llm-judge protocol chain with mock JudgeProvider', async () => {
  const workspace = await createWorkspace();
  try {
    await writeYaml(workspace, 'suites/basic.yaml', SUITE_YAML);
    await writeYaml(workspace, 'datasets/task-judge.yaml', JUDGE_TASK_YAML);

    const providers = new Providers();
    providers.register({
      id: 'reference',
      async execute(_ctx, run) {
        return new ExecutionResult({
          output: String(run.params.output ?? ''),
        });
      },
    });

    const graders = new Graders();
    graders.register(
      new LlmJudgeGrader({
        async evaluate(input) {
          assert.match(input.output, /Paris/);
          assert.equal(input.judge.provider, 'aihubmix');
          return {
            pass: true,
            score: 1,
            reason: 'looks correct',
            assertions: input.assertions.map((assertion) => ({
              assertion,
              pass: true,
              reason: 'supported',
            })),
            provider: input.judge.provider,
            model: input.judge.model,
          };
        },
      }),
    );

    const core = new Core({
      tasks: new LocalTask({ rootDir: workspace }),
      stores: new LocalStore({
        rootDir: join(workspace, 'results'),
      }),
      providers,
      graders,
    });

    const suite = await core.loadSuite('basic-llm');
    const summaries = await suite.runTask('basic-llm/task-judge');

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.passRate, 1);

    const runs = await core.listRuns();
    const trials = await core.listTrials(runs[0]!.runId);
    assert.equal(trials[0]?.graderResults[0]?.result.meta?.provider, 'aihubmix');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
