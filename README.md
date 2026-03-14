# YouEval

YouEval 是一个基于 Anthropic Agent 评测理念的 Agent 评测框架

v1 的核心模型是：

1. `suite`：声明任务发现范围。
2. `task`：声明一个评测场景。
3. `task.provider.runs[]`：声明这个场景要跑的参数组。
4. `trial`：同一个 run 的单次执行尝试。对抗模型输出的不稳定性

## 先理解执行模型

一次完整执行的顺序是：

1. 选择一个 `suite`
2. 选择一个 `task`
3. Core 读取这个 task
4. 顺序执行这个 task 下的每个 `provider.runs[]`
5. 每个 run 内再按 `trialsPerTask` 执行一个或多个 `trial`

## 快速开始

### 前置条件

- Node.js >= 20
- pnpm

### 安装

```bash
pnpm install
pnpm build
pnpm test
```

## 公开入口与边界

外部实现只应依赖这些公开入口：

- `@youeval/core`：评测框架核心（Core API、contracts、runtime registry）
- `@youeval/core/tools`：可选 parser / schema 工具能力（DSL 预校验、导入检查、CI lint）
- `@youeval/graders`：内置 graders 与 `registerBuiltinGraders(...)`
- `@youeval/adapter-task-source-local`：本地 YAML 任务源适配器 `LocalTask`
- `@youeval/adapter-result-store-local`：本地结果存储适配器 `LocalStore`
- `@youeval/adapter-observer-console`：控制台观察器 `ConsoleObserver`
- `@youeval/interface-tui`：预置本地交互 TUI

### Tips
- 内置 adapters / graders / TUI 现在按包独立发布，按需安装即可；不应直接依赖 `core/domain/*`、`core/runtime/*`、`core/utils/*` 这类内部实现路径。
- 运行时接入路径默认不依赖 parser。`Tasks` adapter 返回 raw document，Core 自己在加载 suite/task 时完成解析与校验；如果调用方想在任务录入前做预检查，可按需从 `@youeval/core/tools` 使用 `parseSuiteDocument(...)`、`parseTaskDocument(...)` 等工具函数。

## 从 `youapi-agent` 示例入门

这个例子演示的是：用本地 TUI 选择任务，然后调用一个内部 `youapi` eval endpoint，把返回结果交给 grader 判分。

相关文件：

- `examples/youapi-agent/main.ts`
- `examples/youapi-agent/provider.ts`
- `examples/youapi-agent/datasets/youapi-agent/suite.yaml`
- `examples/youapi-agent/datasets/youapi-agent/task-001-chat-smoke.yaml`
- `examples/youapi-agent/datasets/youapi-agent/task-002-board-search-grounded-summary.yaml`

### 第一步：配置环境变量

先在 `examples/youapi-agent/.env` 中准备：

```dotenv
YOUAPI_BASE_URL=http://localhost:4000
EVAL_API_SECRET=
OPENAI_API_KEY=
```

字段说明：

- `YOUAPI_BASE_URL`：youapi 服务地址，provider 会向 `${YOUAPI_BASE_URL}/api/v1/eval/agent/run` 发请求。
- `EVAL_API_SECRET`：内部 eval 接口认证头 `x-internal-secret`。从 Doppler 取一下就行
- `OPENAI_API_KEY`：样例里把 `llm-judge` 的 `default` profile 绑定到 `openai('gpt-4.1-mini')`，所以需要这个 key

### 第二步：启动 TUI

```bash
pnpm build
pnpm --filter @youeval/example-youapi-agent start
```

这两个命令会：

1. 在 workspace 中构建 `@youeval/*` 包
2. 进入 workspace 示例包并用 `tsx` 启动 `examples/youapi-agent/main.ts`
3. 创建 Core、注册 provider / grader
4. 打开交互式 TUI

也可以继续使用根脚本快捷方式：`pnpm example:youapi-agent`（内部同样是先 build，再委托到 workspace 示例包）。

### 第三步：在 TUI 里怎么操作

TUI 顶层菜单分成四组：

- `Suite`
- `Results`
- `Baseline`
- `Manage`

第一次使用，只需要走这条路径：

1. 进入 `Suite`
2. 选择 `Run a task`
3. 选择 suite：`YouAPI Agent`
4. 选择一个 task
5. 观察实时执行面板
6. 执行结束后查看 `Task Results`

执行期间的行为：

- 屏幕会显示当前 `taskId`
- 会显示当前正在跑的 `runName`
- 会显示 trial 进度条
- provider 内部的 `console.log/info/warn/error` 会被重定向到实时面板
- 按 `Esc` 或 `Ctrl+C` 可以中断当前任务流

结果会被写到：

- `examples/youapi-agent/results`

后续你可以在 TUI 的 `Results` 菜单里查看：

- `List all runs`
- `View run report`
- `View trial details`

## 逐个读懂 `youapi-agent` DSL (以 YAML 格式为例)

### 1. `suite.yaml`

`examples/youapi-agent/datasets/youapi-agent/suite.yaml`

```yaml
schemaVersion: "suite.v1"
id: "youapi-agent"
name: "YouAPI Agent"
discover:
  - "youapi-agent/**/*.yaml"
```

每个字段的含义：

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | 必填 | 固定为 `"suite.v1"` | 当前 suite DSL 版本。 |
| `id` | 必填 | 非空字符串 | suite 的稳定标识。 |
| `name` | 必填 | 非空字符串 | TUI 里显示给用户看的名字。 |
| `discover` | 必填 | 非空字符串数组 | 任务发现 glob。相对 `new LocalTask({ rootDir })` 的 `rootDir` 解析。 |

`discover` 在这个例子里表示：

- 从 `examples/youapi-agent/datasets` 这个 rootDir 出发
- 找到 `youapi-agent/**/*.yaml`
- 其中 `suite.yaml` 本身会被识别为 suite
- 其余匹配到的 `task.v1` 文件会作为任务

### 2. `task-001-chat-smoke.yaml`

这是最小可运行的 `youapi-agent` 任务：

```yaml
schemaVersion: "task.v1"
id: "youapi-agent/task-001-chat-smoke"
desc: "Smoke test for the internal youapi eval agent endpoint. Replace the UUIDs with a valid whitelisted test user context before running."

provider:
  id: "youapi-agent"
  runs:
    - name: "agent-can-respond"
      params:
        userId: "6850dead-afa7-41f7-9e1a-91645e0249db"
        spaceId: "019cc16e-48df-73a6-87ad-6e597c86d366"
        boardId: "019cc16f-425a-7d36-a248-afa397d5edc9"
        prompt: "Introduce yourself briefly and summarize the current board in one sentence."
        messageMode: "agent"
        chatModel: "gpt-5-mini"

graders:
  strategy: "ALL"
  layers:
    - name: "non-empty output"
      type: "length-check"
      config:
        min: 1

execution:
  timeoutMs: 120000
  retryOnError: 0
  trialsPerTask: 1
  maxConcurrency: 2
```

#### 顶层字段

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `schemaVersion` | 必填 | 固定为 `"task.v1"` | 当前 task DSL 版本。 |
| `id` | 必填 | 非空字符串 | task 的稳定标识。建议包含业务域和任务名。 |
| `desc` | 可选 | 字符串 | 给人看的说明，不参与执行逻辑。 |
| `category` | 可选 | 字符串 | 自定义分类元数据。 |
| `capability` | 可选 | 字符串 | 自定义能力标签。 |
| `tier` | 可选 | 字符串 | 自定义分层，比如 `L0/L1/L2`。 |
| `difficulty` | 可选 | 字符串 | 自定义难度，比如 `easy/medium/hard`。 |
| `tags` | 可选 | 字符串数组 | 自定义标签。 |
| `lifecycle` | 可选 | object | 自定义生命周期元数据。 |
| `trackedMetrics` | 可选 | object | 自定义跟踪指标定义。 |
| `provider` | 必填 | object | 声明调用哪个 provider、跑哪些 run。 |
| `graders` | 必填 | object | 声明怎么判分。 |
| `execution` | 必填 | object | 声明超时、重试、trial 数、并发等执行策略。 |

#### `provider` 字段

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `provider.id` | 必填 | 非空字符串 | 必须和代码里注册到 `providers` 的 provider 实例 `id` 一致。这里对应 `providers.register(new YouapiAgentProvider())`，其 `id` 为 `youapi-agent`。 |
| `provider.runs` | 必填 | 非空数组 | 一个 task 下要执行的参数组列表。 |
| `provider.runs[].name` | 必填 | 非空字符串 | run 名称，task 内必须唯一，会显示在 TUI 和结果里。 |
| `provider.runs[].params` | 必填 | object | 原样传给 provider 的参数对象。没有 provider 级默认值。每个 run 必须给完整参数。 |

#### `params` 字段在 `youapi-agent` provider 中的含义

这些不是框架保留字段，而是 `examples/youapi-agent/provider.ts` 自己定义的 provider 参数：

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `userId` | 必填 | 非空字符串 | 目标测试用户。 |
| `spaceId` | 必填 | 非空字符串 | 测试空间 ID。 |
| `boardId` | 必填 | 非空字符串 | 当前 board ID。 |
| `prompt` | 必填 | 非空字符串 | 发给 agent 的 prompt。 |
| `messageMode` | 可选 | 字符串 | provider 会原样透传给后端。例子中用 `"agent"`。 |
| `chatModel` | 可选 | 字符串 | 可选覆盖后端聊天模型。provider 会原样透传。 |

这些字段最终会被 POST 到：

```json
{
  "userId": "...",
  "spaceId": "...",
  "boardId": "...",
  "prompt": "...",
  "messageMode": "agent",
  "chatModel": "..."
}
```

#### `graders` 字段

`graders.strategy` 的可选值只有三个：

| 值 | 语义 |
| --- | --- |
| `ALL` | 所有 layer 都必须通过。 |
| `ANY` | 任意一个 layer 通过即可。 |
| `WEIGHTED` | 每个 layer 带权重，按分数聚合，并和 `passThreshold` 比较。 |

这个 smoke task 用的是：

```yaml
graders:
  strategy: "ALL"
  layers:
    - name: "non-empty output"
      type: "length-check"
      config:
        min: 1
```

字段解释：

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `graders.layers[].name` | 必填 | 非空字符串 | 这层 grader 的人类可读名字。 |
| `graders.layers[].type` | 必填 | 非空字符串 | grader 注册名。这里是内置的 `length-check`。 |
| `graders.layers[].config` | 可选 | object | 传给 grader 的配置。具体字段由 grader 自己校验。 |
| `graders.layers[].weight` | 仅 `WEIGHTED` 必填 | 正数 | 当前 layer 的权重。 |

`length-check` 的配置字段：

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `min` | 可选 | `>= 0` 的数字 | 输出最短长度，含边界。 |
| `max` | 可选 | `>= 0` 的数字 | 输出最长长度，含边界。 |

规则：

- `min` 和 `max` 至少要给一个
- 两个都给时必须满足 `min <= max`

#### `execution` 字段

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `timeoutMs` | 必填 | `> 0` 的整数 | 单个 task 的超时时间。 |
| `retryOnError` | 可选 | `>= 0` 的整数 | trial 出错后的重试次数。 |
| `trialsPerTask` | 可选 | `> 0` 的整数 | 每个 run 需要执行多少个 trial。 |
| `maxConcurrency` | 可选 | `> 0` 的整数 | 同一个 run 内 trial 的最大并发数。 |

这个例子里：

- 最多等待 120 秒
- 不重试
- 每个 run 只跑 1 次
- 并发上限设为 2，但因为只跑 1 个 trial，实际不会并发

### 3. `task-002-board-search-grounded-summary.yaml`

这个任务比 smoke task 更接近真实评测：

- 有更完整的元数据
- 使用 `WEIGHTED` 聚合
- 同时检查输出长度、工具调用行为、以及 `llm-judge` 语义判断

它最重要的部分是：

```yaml
category: "youapi-agent"
capability: "board-search-grounded-summary"
tier: "L1"
difficulty: "medium"
tags: ["read-only", "board", "board-search", "tool-calls", "llm-judge"]
```

这些都是自由元数据，当前主要用于描述、筛选和结果解读，不直接改变执行逻辑。

#### `tool-calls` grader 的字段

```yaml
type: "tool-calls"
config:
  required:
    - tool: "list_board"
    - tool: "search_boards"
  forbidden:
    - tool: "write"
    - tool: "edit"
    - tool: "save_materials"
    - tool: "create_board"
  minCalls: 2
  maxCalls: 6
```

`tool-calls` 会读取 `ExecutionResult.trace.turns[].toolCalls`，配置字段如下：

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `required` | 可选 | `Array<{ tool: string }>` | 这些工具名至少要出现一次。 |
| `forbidden` | 可选 | `Array<{ tool: string }>` | 这些工具名一次都不能出现。 |
| `minCalls` | 可选 | `>= 0` 的整数 | 工具调用总数下限。 |
| `maxCalls` | 可选 | `>= 0` 的整数 | 工具调用总数上限。 |

规则：

- 四个字段至少提供一个
- `minCalls <= maxCalls`

#### `llm-judge` grader 的字段

```yaml
type: "llm-judge"
config:
  dimension: "grounded task completion"
  rubric: "Pass only if the final answer accurately summarizes the current board, accurately reflects whether the board search found related boards, and stays strictly read-only."
  assertions:
    - "The answer includes a board-status summary grounded in the observed board state."
    - "The answer includes a board follow-up grounded in the board search result, or clearly says that no related boards were found."
    - "The answer does not claim to have created, edited, saved, or modified any content."
  passThreshold: 1
  contextFrom: "trace.turns"
  judge:
    profile: "default"
```

字段解释：

| 字段 | 是否必填 | 值类型 / 可选值 | 说明 |
| --- | --- | --- | --- |
| `dimension` | 必填 | 非空字符串 | 这次语义评估关注的维度名字。 |
| `rubric` | 必填 | 非空字符串 | 给 judge 模型的总评分标准。 |
| `assertions` | 必填 | 非空字符串数组 | 逐条二元断言。 |
| `passThreshold` | 必填 | `0 < x <= 1` | judge 分数达到多少才算通过。 |
| `contextFrom` | 可选 | 字符串路径 | 从 `ExecutionResult` 中抽取额外上下文。比如 `trace.turns`、`outcome.reference`。 |
| `judge.profile` | 必填 | 非空字符串 | 选择逻辑 judge profile；实际模型由运行时注册。 |

要让 `llm-judge` 生效，代码里必须显式注册：

```ts
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const graders = new Graders();
registerBuiltinGraders(graders);
graders.register(
  new BuiltinLlmJudgeGrader({
    profiles: {
      default: openai('gpt-4.1-mini'),
    },
  }),
);
```

注意：

- `registerBuiltinGraders(...)` 不会自动注册 `llm-judge`
- task YAML 只负责写 `judge.profile`
- API key、provider 选择、模型实例化都在运行时组合层完成，不写进 task YAML


## 从 0 配置一个完整 eval （以 YAML 编写 DSL 为例）

如果你要自己新建一套 eval，按这个顺序做就够了。

### 1. 准备目录

推荐结构：

```text
my-example/
  main.ts
  provider.ts
  results/
  datasets/
    my-suite/
      suite.yaml
      task-001.yaml
```

### 2. 写 `suite.yaml`

```yaml
schemaVersion: "suite.v1"
id: "my-suite"
name: "My Suite"
discover:
  - "my-suite/**/*.yaml"
```

最小要求：

- `schemaVersion: "suite.v1"`
- `id`
- `name`
- 至少一个 `discover` glob

### 3. 写最小 `task.yaml`

```yaml
schemaVersion: "task.v1"
id: "my-suite/task-001"
desc: "Minimal hello-world eval"

provider:
  id: "my-provider"
  runs:
    - name: "default"
      params:
        prompt: "Say hello in one sentence."

graders:
  strategy: "ALL"
  layers:
    - name: "must not be empty"
      type: "length-check"
      config:
        min: 1

execution:
  timeoutMs: 30000
  retryOnError: 0
  trialsPerTask: 1
  maxConcurrency: 1
```

这份 task 已经是一个完整可执行单元。

### 4. 写 provider

你的 provider 只需要实现这个签名：

```ts
interface Provider {
  readonly id: string;
  execute(ctx: TaskContext, run: Run): Promise<ExecutionResult>;
}
```

你需要做的事通常只有三步：

1. 从 `run.params` 里取业务参数
2. 调用真实系统的 Agent 业务
3. 将 Agent 结构格式化为 `ExecutionResult` 返回

`ctx` 里会带：

- `taskId`
- `trialIndex`
- `runName`
- `runId`
- `signal`

其中 `signal` 用于超时和取消控制，发请求时应该继续透传。

### 5. 在 `main.ts` 里接线

最小版本：

```ts
// ai sdk 模型 provider
const openai = createOpenAI({
  baseURL: 'https://aihubmix.com/v1',
  apiKey: process.env.AIHUBMIX_API_KEY,
});

// 谁来运行 youapi
const providers = new Providers();
providers.register(new YouapiAgentProvider());

// 评分器
const graders = new Graders();
registerBuiltinGraders(graders);
graders.register(
  new BuiltinLlmJudgeGrader({
    profiles: {
      default: openai('gpt-5.4'),
    },
  }),
);

const core = new Core({
  // task 来源
  tasks: new LocalTask({
    rootDir: resolve(currentDir, 'datasets'),
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
```

## DSL 速查

### Suite DSL

```yaml
schemaVersion: "suite.v1"
id: "my-suite"
name: "My Suite"
discover:
  - "datasets/**/*.yaml"
```

### Task DSL

```yaml
schemaVersion: "task.v1"
id: "my-suite/task-001"
desc: "Example task"
category: "agent"
capability: "grounded-summary"
tier: "L1"
difficulty: "medium"
tags: ["read-only"]

provider:
  id: "my-provider"
  runs:
    - name: "baseline"
      params:
        prompt: "Hello"

graders:
  strategy: "ALL"
  layers:
    - name: "not empty"
      type: "length-check"
      config:
        min: 1

execution:
  timeoutMs: 30000
  retryOnError: 0
  trialsPerTask: 1
  maxConcurrency: 1
```

## 内置 grader

`registerBuiltinGraders(...)` 会注册这些内置 grader：

- `exact-match`
- `contains`
- `regex`
- `json-schema`
- `length-check`
- `tool-calls`
- `transcript`
- `outcome-check`
- `latency-threshold`
- `token-budget`

`llm-judge` 由于需要选择对应的模型 provider，需要自己显式注册。

## Core API

```ts
const core = new Core({
  tasks,
  stores,
  providers,
  graders,
  observers,
  runtimeDefaults: {
    maxConcurrency: 5,
  },
});

const suites = await core.suites.list();
const loadedSuite = await core.suites.load(suites[0].id);
const tasks = await loadedSuite.listTasks();
const summaries = await loadedSuite.runTask(tasks[0].id);
```

主要入口按职责分组：

- `core.suites.list()`
- `core.suites.load(input)`
- `core.suites.loadMany(...inputs)`
- `loadedSuite.listTasks()`
- `loadedSuite.runTask(taskId)`
- `loadedSuite.streamTask(taskId)`
- `core.results.list()`
- `core.results.getManifest(runId)`
- `core.results.getSummary(runId)`
- `core.results.listTrials(runId)`
- `core.results.clearAll()`
- `core.results.clearByRunIds(runIds)`
- `core.baseline.compare(currentRunId, options)`

`core.suites.load(...)` 返回的是公开 API handle，不是内部 domain `Suite` 实现；外部模块应只使用这些公开方法和返回的 record 数据。
内部 `Suite` 现在只是纯定义/value object，不再承载 `listTasks`、`runTask`、`streamTask` 这类运行时动作。
`core.baseline.compare(...)` 必须显式传 `baselineRunId`，并且只允许比较同一个 `taskId` 的两次 run；如果 baseline 和 current 属于不同 task，会直接报错。
