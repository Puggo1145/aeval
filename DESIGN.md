# YouEval Design (Core-First Evaluate System)

## 0. 文档定位

本文档是 `youeval` 的统一设计与搭建指南，目标是定义一套可在本地参考适配器组合下独立运行、可持续演进、可按需接入外部平台的 Agent 评测系统。

这份文档采用 **Core-First, Platform-Adapter-Optional** 架构：

- `youeval Core` 承担所有评测核心职责
- 外部平台仅作为可插拔适配器，不进入 Core 语义层
- `TaskSourceAdapter` / `ResultStoreAdapter` / `Provider` 抽象属于 Core 语义，不可移除

---

## 1. 目标与边界

### 1.1 目标

1. 对 `youapi` 的 AI 能力进行可重复、可对比、可回归的评测。
2. 同时覆盖三类对象：
   - 端到端 Agent
   - Runners
   - 各类 Tool 调用链
3. 评测结论以 `Outcome`（真实环境结果）为核心，而不是仅看模型文本。
4. Core 在无第三方平台情况下，依赖本地参考适配器可完整运行。

### 1.2 非目标

1. 不在 Core 内实现可视化 Web UI。
2. 不把 Core 绑死到任意外部平台。
3. 不让 `youapi` 为评测框架做侵入式生产改造（除可选观测增强）。

### 1.3 核心原则

1. **Contract First**：先冻结契约，再实现能力。
2. **Core Independence**：Core 必须独立于具体平台 SDK，并可通过最小参考适配器组合完成评测闭环。
3. **Platform Adapter Optional**：外部平台接入必须可拔插、可降级；但输入/输出/执行边界的 adapter 抽象必须存在。

---

## 2. 冻结术语（Building Blocks）

以下术语为 `youeval` 的基础语义，**定义冻结**，后续扩展不得改变其含义。

### 2.1 Anthropic 8 个 Building Blocks
原文：https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents

| 术语 | 定义 | YouMind 映射 |
|------|------|-------------|
| **Task** | 一个测试用例，包含场景输入、评分标准和元数据 | 一条 dataset item（如“在 board X 中问 Y 问题”） |
| **Trial** | 对同一个 task 的一次执行尝试，用来对抗 LLM 输出的不稳定性 | 一次 provider 调用的完整流程 |
| **Transcript / Trace** | 一次 trial 的完整执行记录（输出、tool calls、中间结果） | 全量执行 trace（CompletionBlocks） |
| **Outcome** | trial 结束后的最终环境状态——真实世界发生了什么，而不是 agent 声称发生了什么 | 数据库中实际创建的 board/material、tool 调用的实际结果、环境的真实变化 |
| **Grader** | 评分逻辑，可基于 output/trace/outcome/metrics 任一维度判定 | 规则评分器 / LLM-as-Judge / 人工评分 |
| **Agent Harness** | 被测系统本身——使模型能够作为 agent 行动的系统（处理输入、编排 tool 调用、返回结果） | youapi 的 agent 系统 |
| **Eval Harness** | 运行 eval 的基础设施（加载 task、调度 trial、调用 grader、生成报告） | youeval Core runtime |
| **Eval Suite** | 测量特定能力的 task 集合 | 外部数据源中的 task 集合 |

### 2.2 YouEval 扩展术语

| 术语 | 定义 | YouMind 映射 |
|------|------|-------------|
| **Provider** | 适配层，负责 setup -> 调用 Agent Harness -> teardown，将结果翻译为 ExecutionResult | 业务代码实现的桥接模块 |

### 2.3 pass@k 与 pass^k

- **pass@k**：k 次尝试中至少 1 次成功的概率。
- **pass^k**：k 次尝试全部成功的概率。

面向真实用户可靠性时，默认以 `pass^k` 为主指标。

---

## 3. Core 总体架构

### 3.1 分层模型

```
┌────────────────────────────────────────────────────────────┐
│                        youeval Core                        │
│                                                            │
│  Spec Layer      Runtime Layer      Grader Layer          │
│  - Task DSL      - Orchestrator     - Built-in graders    │
│  - Experiment    - Trial engine     - LLM judge adapter   │
│                                                            │
│  Input Layer     Storage Layer      Core API Layer         │
│  - TaskSource    - ResultStore      - runExperiment()      │
│  - Resolver      - Baselines        - streamRun()          │
│                                    - getRunSummary()       │
│                                    - listTrials()          │
└────────────────────────────────────────────────────────────┘
                           │
                           │ Adapter boundary
                           ▼
┌────────────────────────────────────────────────────────────┐
│                    Adapter Implementations                 │
│  - TaskSource adapters (file / API / mirror)               │
│  - ResultStore adapters (filesystem / remote store)        │
│  - Observer adapters (console / tracing sink)              │
│  - Interface adapters (CLI / interactive / HTTP / TUI)     │
└────────────────────────────────────────────────────────────┘
```

### 3.2 依赖方向

1. Core 不依赖业务模块。
2. Provider 依赖 Core 契约和业务实现。
3. TaskSource Adapter 依赖 Core 输入契约。
4. ResultStore Adapter 依赖 Core 输出契约。
5. Core 不依赖任何 Adapter SDK。
6. Interface adapters（CLI/interactive/HTTP/TUI）依赖 Core API，不反向依赖。
7. Core 不依赖 `argv/stdin/stdout` 等交互介质。
8. Core 的运行依赖 adapter 接口与至少一组可用实现（input/output）。

### 3.3 目录建议

```text
apps/youeval/
  README.md
  DESIGN.md
  src/
    core/
      contracts/
      loader/
      task-source/
      orchestrator/
      runtime/
      api/
      store/
      baseline/
      observers/
    graders/
      builtins/
      llm/
    adapters/
      task-source/
      result-store/
      observer/
    interfaces/
      cli/
      interactive/
      http/
  datasets/
    chat-agent/
    runner/
    tool/
  providers/
    chat-agent.ts
    overview.ts
    tool-cases.ts
```

### 3.4 Core 与多种交互模式的连接方式

Core 对外只暴露稳定的程序化 API，交互模式作为 interface adapter 按需接入：

1. `createCore(deps) -> CoreApi`：在组合根一次性注入依赖。
2. `core.runExperiment(input) -> Promise<RunSummary>`：批处理执行一次 run。
3. `core.streamRun(input) -> AsyncIterable<RunEvent>`：返回事件流，供交互模式实时展示进度。
4. `core.getRunSummary(runId)` / `core.listTrials(runId)`：按 `runId` 查询结果，来源仅 `ResultStoreAdapter`。
5. `core.listRuns() -> Promise<RunSummaryRecord[]>`：列出所有已落盘 run summary。
6. `core.setBaseline(runId)` / `core.compareBaseline(currentRunId, baselineRunId?)`：基线管理。

连接规则：

1. CLI 是一种 interface adapter 具体实现：解析命令参数，调用 `CoreApi`，并可在交互会话中消费 `streamRun` 事件。
2. v1 至少提供一个可用的 interactive interface adapter 具体实现（可由 CLI 承担）。
3. 未来 HTTP/TUI 作为其他 interface adapter，复用同一组 Core API，不复制 orchestration 逻辑。
4. Query/Baseline API 按 `runId` 自动路由到目标 `ResultStoreAdapter`；未命中时 query 返回空值，冲突命中 fail fast。
5. `listRuns()` 聚合所有 `ResultStoreAdapter` 的 run summary；若同一 `runId` 在多个 store 命中，必须 fail fast。

---

## 4. Core 契约设计（Contract）

`ExecutionResult` 是 Core 的唯一执行数据契约。Provider 产出它，Grader 消费它，Store/Observer 读取它。
为保证可演进性，Core 的关键对象必须显式携带 `schemaVersion`。
完整契约清单由下游契约文档维护。

### 4.1 ExecutionResult

```typescript
export interface ExecutionResult {
  schemaVersion: 'execution-result.v1'
  output: string
  structuredOutput?: unknown
  trace?: {
    turns?: TurnRecord[]
    rawEvents?: unknown[]
  }
  metrics?: {
    latencyMs?: number
    timeToFirstTokenMs?: number
    model?: string
    tokenUsage?: {
      input?: number
      output?: number
      total?: number
    }
    [key: string]: unknown
  }
  outcome?: Record<string, unknown>
  error?: {
    type: 'agent' | 'system'
    message: string
    code?: string
    retryable?: boolean
  }
}

export interface ToolCallRecord {
  tool: string
  params?: Record<string, unknown>
  result?: unknown
  durationMs?: number
}

export interface TurnRecord {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallRecord[]
}
```

### 4.2 TaskContext

```typescript
export interface TaskContext {
  taskId: string
  trialIndex: number
  runName: string
  runId: string
  overrides: Readonly<Record<string, unknown>>
  signal: AbortSignal
}
```

### 4.3 Provider Interface 与 Registry

```typescript
export type TaskProvider = (
  ctx: TaskContext,
  params: Readonly<Record<string, unknown>>
) => Promise<ExecutionResult>

export interface ProviderRegistry {
  register(providerId: string, provider: TaskProvider): void
  get(providerId: string): TaskProvider | undefined
  has(providerId: string): boolean
  list(): string[]
}
```

### 4.4 Grader Interface & Registry

```typescript
export interface GraderResult {
  pass: boolean
  score?: number
  reason: string
  meta?: Record<string, unknown>
}

export type Grader = (
  result: ExecutionResult,
  config: Record<string, unknown>
) => Promise<GraderResult>

export interface GraderRegistry {
  register(type: string, grader: Grader): void
  get(type: string): Grader | undefined
  has(type: string): boolean
  list(): string[]
}
```

内置 grader 在应用组合根通过 `registerBuiltinGraders` 预注册到 `GraderRegistry`（注册仅声明可用实现，不代表执行）；`custom` 类型通过 `register` 动态注册。Task DSL 中 `graders.layers[].type` 必须在 `GraderRegistry` 中可解析，实际执行严格由 task 的 `graders.layers` 决定。

### 4.5 Trial / Run 聚合结构

```typescript
export interface TrialResult {
  schemaVersion: 'trial-result.v1'
  taskId: string
  runId: string
  runName: string
  trialIndex: number
  execution: ExecutionResult
  graderResults: Array<{
    name: string
    type: string
    result: GraderResult
    weight: number
  }>
  aggregate: {
    pass: boolean
    score?: number
  }
  timings: {
    startedAt: string
    endedAt: string
    durationMs: number
  }
}

export interface RunSummary {
  schemaVersion: 'run-summary.v1'
  runId: string
  runName: string
  totalTasks: number
  totalTrials: number
  passRate: number
  passAtK?: number
  passHatK?: number
  avgLatencyMs?: number
}
```

### 4.6 ResultStore Adapter Interface
Core 只通过一个接口做结果持久化与读取，不关心底层是文件、数据库还是远端服务。

```typescript
export interface ResultStoreAdapter {
  saveRunManifest(input: RunManifest): Promise<void>
  saveRunSummary(input: RunSummaryRecord): Promise<void>
  saveTrial(input: TrialResultRecord): Promise<void>

  getRunManifest(runId: string): Promise<RunManifest | null>
  getRunSummary(runId: string): Promise<RunSummaryRecord | null>
  listTrials(runId: string): Promise<TrialResultRecord[]>
  listRunIds(): Promise<string[]>
  saveBaseline(input: BaselineRecord): Promise<void>
  getBaselineRunId(): Promise<string | null>
}

export interface RunManifest {
  schemaVersion: 'run-manifest.v1'
  runId: string
  experimentName: string
  gitSha?: string // optional — 无 git 环境时可省略
  taskSource: {
    adapter: string
    ref: string
    revision: string
  }
  datasetHash: string
  configHash: string
  startedAt: string
  completedAt?: string
}

export interface RunSummaryRecord {
  runId: string
  summary: RunSummary
}

export interface TrialResultRecord {
  runId: string
  trial: TrialResult
}

export interface BaselineRecord {
  runId: string
  updatedAt: string
}
```

实现要求：

1. **v1 必须实现至少一个 reference `ResultStoreAdapter`**，保证 Core 在无外部平台下可运行。
2. 其他 `ResultStoreAdapter` 实现属于后续扩展能力，不阻塞 v1 落地。
3. Core 只依赖接口，不依赖具体 adapter SDK。
4. 读取能力是 Core 的一等能力，不通过外部平台反查。

### 4.7 TaskSource Adapter Interface

Core 必须通过 `TaskSourceAdapter` 读取 task 输入，不直接绑死某种存储介质。

```typescript
export interface TaskSourceAdapter {
  resolveDataset(): Promise<ResolvedDataset>
}

export interface ResolvedDataset {
  source: {
    adapter: string
    ref: string
    revision: string
    fetchedAt: string
  }
  tasks: unknown[]
  datasetHash: string
}
```

实现要求：

1. 评测运行必须基于不可变 revision，而不是可变草稿。
2. `resolveDataset` 失败要在 run 启动前 fail fast。
3. `RunManifest` 必须记录 `adapter/ref/revision/datasetHash`，用于审计与复现。
4. v1 至少提供一个可用 `TaskSourceAdapter` 实现（可为 local）。
5. 更多 `TaskSourceAdapter` 实现按 milestone 扩展接入。

---

## 5. Task DSL 设计（YAML）

### 5.1 Task 规范

```yaml
task:
  schemaVersion: "task.v1"
  id: "chat-agent/board-qa/basic-factual-001"
  desc: "Answer a factual question using board content without hallucination"
  category: "chat-agent"
  capability: "board-qa"
  tier: "L0"
  difficulty: "easy"
  tags: ["factual", "single-turn", "en-US"]

  lifecycle:
    status: "active"
    created: "2026-02-28"
    source: "manual"
    sourceRef: null
    graduatedFrom: null

  provider:
    id: "chat-agent.board-qa"
    params:
      setupRecipeId: "board.tech-articles.v1"
      userMessage: "What are the main advantages of React Server Components?"
      userLocale: "en-US"

  graders:
    strategy: "ALL"
    passThreshold: null
    layers:
      - name: "contains key concept"
        type: "contains"
        weight: 1.0
        config:
          mustInclude:
            - pattern: "Server Components"
              caseSensitive: false

      - name: "forbid fallback phrase"
        type: "regex"
        weight: 1.0
        config:
          mustNotMatch:
            - pattern: "I cannot find"
              flags: "i"

      - name: "tool behavior"
        type: "tool-calls"
        weight: 1.0
        config:
          required:
            - tool: "searchBoards"
          forbidden:
            - tool: "createBoard"

      - name: "outcome safety"
        type: "outcome-check"
        weight: 1.0
        config:
          expect:
            boardModified: false
            materialsCreated: 0

      - name: "semantic faithfulness"
        type: "llm-judge"
        weight: 1.5
        config:
          dimension: "faithfulness"
          model: "judge-model-default"
          contextFrom: "outcome.boardContent"
          rubric: |
            PASS if answer is grounded in board content.
            FAIL if answer introduces unsupported claims.
            UNKNOWN if evidence is insufficient.

  trackedMetrics:
    transcript:
      - "n_turns"
      - "n_tool_calls"
    latency:
      - "time_to_first_token"
      - "time_to_last_token"
    cost:
      - "estimated_cost_usd"

  execution:
    timeoutMs: 60000
    retryOnError: 1
    trialsPerTask: null
```

### 5.2 Experiment 规范

```yaml
experiment:
  schemaVersion: "experiment.v1"
  name: "chat-agent-model-compare"
  taskSource:
    adapter: "task-source-adapter-id"
  runs:
    - name: "model-a"
      overrides:
        chatModel: "model-a"
    - name: "model-b"
      overrides:
        chatModel: "model-b"
  trialsPerTask: 3
  maxConcurrency: 5
  timeoutMs: 120000
  resultStore:
    adapter: "result-store-adapter-id"

  observers:
    - type: "observer-adapter-id"
```

### 5.3 DSL 校验规则

1. `task.schemaVersion` 必须受支持（当前仅 `task.v1`）。
2. `experiment.schemaVersion` 必须受支持（当前仅 `experiment.v1`）。
3. `task.id` 在同一 dataset revision 内全局唯一。
4. `provider.id` 必须能在 `ProviderRegistry` 解析。
5. `graders.layers` 至少一个。
6. `strategy=WEIGHTED` 时必须提供 `passThreshold`。
7. `execution.timeoutMs` 必须 > 0。
8. 若使用 `experiment.taskSource`，`adapter` 必填且必须能解析到已注册 `TaskSourceAdapter`。
9. 运行前必须通过 `TaskSourceAdapter.resolveDataset()` 解析到不可变 `revision`。
10. `task.tags` 若提供，必须是 `string[]`。
11. `task.lifecycle` 若提供，必须是对象。
12. `task.desc/category/capability/tier/difficulty` 若提供，必须是 string。
13. Task/Experiment DSL 对象内的未知字段必须在校验阶段直接报错（fail fast）。

---

## 6. Runtime 设计（Core Engine）

### 6.1 执行状态机

```text
LOADED -> SETUP -> RUNNING -> GRADING -> FINALIZED
                   |          |
                   |          -> ERROR (agent/system)
                   -> TIMEOUT
```

### 6.2 Trial 生命周期

1. 通过 `TaskSourceAdapter` 解析数据集并冻结 revision。
2. 读取 Task 配置。
3. 构建 `TaskContext`（含 `AbortSignal`）。
4. 调用 Provider 执行真实场景。
5. 产出 `ExecutionResult`。
6. 按 layer 顺序执行 graders。
7. 根据 strategy 计算 aggregate pass/score。
8. 写入 `ResultStoreAdapter`（保存 run/trial）。
9. 通知 observers（console/remote 等，best-effort 且有超时上限，不影响主判定语义）。

### 6.3 并发与隔离

1. `maxConcurrency` 控制并发 trial 数。
2. 每个 trial 独立 setup/teardown。
3. 单 trial 失败不终止整 run。
4. 超时通过 `AbortSignal` 传递到 Provider。

### 6.4 错误语义

1. `error.type=agent`：行为失败，算评测失败。
2. `error.type=system`：系统异常，重试策略由 `error.retryable` 与配置共同决定。
3. `timeout` 归类为 `system` 且默认 `retryable=false`（不重试）。
4. 非 timeout 的 `system` 错误默认可按 `retryOnError` 重试。
5. ResultStore 写入失败采用 `strict-only`：
   - 直接终止 run 并报错，不做任何 fallback 写入

---

## 7. Grader 体系设计

### 7.1 内置 grader（Core 必备）

| Grader | 读取字段 | 用途 |
|--------|---------|------|
| exact-match | output | 精确结果 |
| contains | output | 关键词存在/不存在 |
| regex | output | 模式校验 |
| json-schema | structuredOutput | 结构校验 |
| length-check | output | 长度约束 |
| tool-calls | trace.turns[].toolCalls | 工具调用行为 |
| transcript | trace.turns | 多轮行为约束 |
| outcome-check | outcome | 真实环境结果校验 |
| latency-threshold | metrics.latencyMs | 性能门槛 |
| token-budget | metrics.tokenUsage | 成本约束 |
| custom | ExecutionResult | 复杂业务校验 |
| llm-judge | output + context | 语义评测 |

### 7.2 组合策略

- `ALL`：全部通过才通过
- `ANY`：任一通过即通过
- `WEIGHTED`：加权得分 >= 阈值

### 7.3 LLM Judge 抽象

Core 只定义协议，不绑定具体平台。

```typescript
export interface JudgeProvider {
  evaluate(input: {
    output: string
    rubric: string
    context?: unknown
    dimension: string
  }): Promise<{
    pass: boolean
    score?: number
    reason: string
    label?: 'PASS' | 'FAIL' | 'UNKNOWN'
  }>
}
```

---

## 8. 数据与基线（Core 自有）

### 8.1 持久化策略

Core 只关心 `ResultStoreAdapter` 接口，不关心存储介质：

1. v1 至少要求一个 reference `ResultStoreAdapter` 实现。
2. 扩展实现按团队节奏接入，不影响 Core 契约稳定。
3. 无论底层介质如何，Core 读取/判定语义保持一致。

### 8.2 ResultStoreAdapter 例子（非规范）

只举例，不约束具体实现：

1. `file-store`：按 run/trial 写文件，适合本地验证。
2. `remote-store`：按 run/trial 写远端服务，适合团队共享。

### 8.3 ResultStoreAdapter 设计约束

1. 必须完整支持 `save/get/list/baseline` 契约，不暴露底层介质细节到 Core。
2. 写入失败语义为 `strict-only`：写入失败即报错并终止当前 run，不做降级写入。
3. 大对象分层存储属于扩展能力，不进入 v1 必选契约。

### 8.4 基线管理规则

1. 基线计算通过 `ResultStoreAdapter` 读取 run summary。
2. 支持 capability -> regression 升级。
3. 回归判定基于：
   - passRate delta
   - pass^k delta
   - latency/token budget breach
4. 回归阈值由调用方传入，Core 不硬编码默认值。
5. 若调用方提供回归阈值，阈值必须是有限且非负的数字（`>= 0`）。

### 8.5 CI 判定来源

CI 通过 Core 命令读取 `ResultStoreAdapter`：

1. reference adapter 场景：读本地记录。
2. remote adapter 场景：读远端记录。

结论判定始终由 Core 统一完成，不依赖 observer 写入状态。

---

## 9. Provider 设计指南（youapi 实战）

Provider 负责把“真实业务环境”桥接进 Core。

### 9.1 Provider 职责

1. setup：准备 user、board、materials、craft 等测试环境。
2. execute：调用 youapi ai 端点。
3. collect：解析 output/trace/metrics。
4. verify：独立收集 outcome（直接查 DB/API，零信任 agent 的文本结果）。
5. teardown：清理资源。

### 9.2 Provider 示例

```typescript
import type { ExecutionResult, TaskContext } from './core/contracts'

export async function boardQA(
  ctx: TaskContext,
  params: Record<string, unknown>
): Promise<ExecutionResult> {
  const { setupRecipeId, userMessage } = params as {
    setupRecipeId: string
    userMessage: string
  }

  const env = await prepareEnvironment(setupRecipeId)
  const start = Date.now()

  try {
    const events = await runYouapiSSE({
      userId: env.userId,
      boardId: env.boardId,
      message: userMessage,
      overrides: ctx.overrides,
      signal: ctx.signal,
    })

    return {
      schemaVersion: 'execution-result.v1',
      output: extractOutput(events),
      trace: {
        turns: extractTurns(events),
        rawEvents: events,
      },
      metrics: {
        latencyMs: Date.now() - start,
        timeToFirstTokenMs: extractTTFT(events),
        tokenUsage: {
          input: extractInputTokens(events),
          output: extractOutputTokens(events),
          total: extractInputTokens(events) + extractOutputTokens(events),
        },
        model: extractModel(events),
      },
      outcome: {
        boardContent: await readBoardContent(env.boardId),
        boardModified: await isBoardModified(env.boardId),
        materialsCreated: await countCreatedMaterials(env.boardId),
        craftsCreated: await countCreatedCrafts(env.boardId),
      },
    }
  } finally {
    await cleanupEnvironment(env)
  }
}
```

### 9.3 board/material/craft 场景如何进入 Task

Task 不直接塞入完整实体数据，而是放“可执行引用”：

```yaml
provider:
  id: "chat-agent.board-qa"
  params:
    setupRecipeId: "board.research-pack.v3"
    userMessage: "Summarize the key findings"
    securityProfile: "standard"
```

`setupRecipeId` 对应一套可重复的环境准备逻辑，由 Provider 在运行时落地成真实用户与真实资源。
`provider.id` 通过 `ProviderRegistry` 映射到实际实现，避免运行时动态路径解析失败。

---
---

## 10. Adapter 概念边界（Core 相关）

当前阶段仅保留 Core 必需的 adapter 抽象，不展开平台实现细节。

1. 输入侧通过 `TaskSourceAdapter` 抽象数据源。
2. 输出侧通过 `ResultStoreAdapter` 抽象结果存储。
3. 执行侧通过 `Provider` 抽象被测系统调用。
4. 可选观测通过 `ObserverAdapter` 抽象上报接口。
5. 交互层通过 `Interface Adapter` 抽象（CLI/interactive/HTTP/TUI）。
6. Core 闭环定义为：在一组参考适配器（如 reference task source + reference result store + reference provider）下完成输入、执行、判定、输出。
7. 评测判定只能依赖 Core 与 `ResultStoreAdapter` 读取结果。
8. 外部平台与协作流程属于后续阶段，不影响当前 core 里程碑。

## 11. 常见问题

### Q1. 是否必须接入外部平台才能运行评测？

不是。Core 无需外部平台，但仍需要至少一组可用 adapter 实现（本地或外部）来完成输入/执行/输出闭环。

### Q2. 涉及业务真实 board/material/craft 的场景，dataset 怎么承载？

dataset 仅存场景引用（如 `setupRecipeId`），真实环境由 Provider 在 trial 运行时创建。

### Q3. 如何保证评测结果可复现？

通过固定 `taskSource` 解析结果（`adapter/ref/revision`）并记录 `datasetHash`。

### Q4. 当前阶段文档重点是什么？

重点是 core 契约、执行引擎、grader、结果存储与可复现性；平台 adapter 细节后置。

---

## 12. 参考资料

- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
