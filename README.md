# YouEval

The evaluation infra for YouMind AI capabilities.

This repository is currently in an early stage. We keep docs lightweight and evolve them continuously.

## What This Project Is

1. Contract-first eval runtime.
2. Outcome-first grading (not only text output).
3. Core-first architecture with clear adapter abstractions.

## Quickstart

### Prerequisites

- Node.js >= 20
- pnpm

### Install & Build

```bash
pnpm install
pnpm build
```

### Run the smoke experiment

```bash
node --import tsx src/interfaces/cli/entry.ts run \
  --experiment experiments/chat-agent-smoke.yaml --run smoke
```

### View results

```bash
# List all runs
node --import tsx src/interfaces/cli/entry.ts runs

# Show run summary
node --import tsx src/interfaces/cli/entry.ts report <runId>

# Show individual trials
node --import tsx src/interfaces/cli/entry.ts trials <runId>
```

### Baseline management

```bash
# Set a run as baseline
node --import tsx src/interfaces/cli/entry.ts baseline set <runId>

# Compare a run against the baseline
node --import tsx src/interfaces/cli/entry.ts baseline compare <runId>
```

---

# YouEval Core V1 完整使用指南

## 一、YouEval 是什么

YouEval 是一个 **AI Agent/LLM 评测框架**。它的核心流程是：

```
Experiment (实验定义) → 加载 Tasks (任务集) → 执行 Provider (被测对象) → Grader 评分 → 聚合结果
```

评测定义通过 YAML 声明；adapter 实例配置在组合根注入。核心引擎用 TypeScript 实现，运行在 Node.js >= 20 上。

---

## 二、核心概念

### 1. Experiment（实验）

实验是最顶层的配置单元，定义"评测什么、怎么评、结果存哪"。对应 `experiments/*.yaml`。

```yaml
schemaVersion: "experiment.v1"
name: "chat-agent-smoke"
taskSource:
  adapter: "local"                    # 任务加载适配器
runs:
  - name: "smoke"                     # run 配置名（一个实验可定义多个 run）
    overrides: {}                     # 可选：传给 provider 的覆盖参数
maxConcurrency: 2                     # 并发 trial 数
trialsPerTask: 1                      # 每个 task 执行几次（默认 1）
timeoutMs: 30000                      # 可选：全局超时覆盖
resultStore:
  adapter: "local"                    # 结果存储适配器
observers:                            # 可选：事件观察者
  - type: "console"
```

关键字段说明：
- **runs**: 数组，每个元素是一个 run 配置。run name 在实验内必须唯一。执行时通过 `--run` 指定跑哪个。
- **maxConcurrency**: 控制 trial 级别的并发数。
- **trialsPerTask**: 全局默认值，task 级可覆盖。当 > 1 时，summary 会产出 pass@k / pass^k 指标。
- **taskSource.adapter**: 声明运行时使用哪个任务源实例。`local` 数据集定位参数（`datasetsRoot/dataset/revision/tag`）在 `createAppCore({...})` 注入时配置。

### 2. Task（任务）

Task 是评测的最小单元，定义"对被测对象说什么、怎么评分"。存放在 `.datasets/` 目录下，每个文件一个 task。

```yaml
task:
  schemaVersion: "task.v1"
  id: "chat-agent/smoke/basic-echo-001"    # 全局唯一 ID
  desc: "Echo back a simple user message"  # 可选描述
  category: "chat-agent"                   # 可选分类元数据
  capability: "echo"
  tier: "L0"
  difficulty: "easy"
  tags: ["smoke", "single-turn", "en-US"]  # 可选标签（支持按 tag 过滤）

  provider:
    id: "reference"                        # provider 名称（需已注册）
    params:                                # 传给 provider 的参数
      output: "Hello, world!"

  graders:
    strategy: "ALL"                        # 聚合策略: ALL / ANY / WEIGHTED
    layers:                                # 评分层（至少一个）
      - name: "contains greeting"
        type: "contains"                   # grader 类型
        config:
          mustInclude:
            - pattern: "Hello"
              caseSensitive: false

  execution:
    timeoutMs: 10000                       # 单次 trial 超时
    retryOnError: 0                        # 系统错误重试次数
    trialsPerTask: null                    # null 使用实验级默认值
```

### 3. Provider（执行器）

Provider 是被测对象的抽象。函数签名：

```typescript
type TaskProvider = (
  ctx: TaskContext,    // 包含 taskId, trialIndex, runName, runId, overrides, signal
  params: Record<string, unknown>,  // task.provider.params 的值
) => Promise<ExecutionResult>;
```

**TaskContext** 提供给 provider 的上下文：
- `taskId` — 当前 task ID
- `trialIndex` — 第几次 trial（0-based）
- `runName` / `runId` — run 信息
- `overrides` — 来自 experiment.runs[].overrides，不可变
- `signal` — AbortSignal，用于超时/取消

**内置 provider**:
- `reference` — 直接返回 `params.output` 作为输出，用于测试/smoke test。它还会自动生成 trace（user/assistant turns）和估算 token 用量。

要评测真实 agent，你需要注册自己的 provider。

### 4. ExecutionResult（执行结果）

Provider 返回的标准数据结构：

```typescript
interface ExecutionResult {
  schemaVersion: "execution-result.v1";
  output: string;                      // 主输出（文本）
  structuredOutput?: unknown;          // 结构化输出（供 json-schema grader 使用）
  trace?: {
    turns?: TurnRecord[];              // 对话轮次记录
    rawEvents?: unknown[];
  };
  metrics?: {
    latencyMs?: number;                // 延迟
    timeToFirstTokenMs?: number;
    model?: string;
    tokenUsage?: { input?: number; output?: number; total?: number };
    [key: string]: unknown;
  };
  outcome?: Record<string, unknown>;   // 环境副作用结果（如文件是否创建成功）
  error?: {
    type: 'agent' | 'system';          // agent=被测者错误，system=框架错误
    message: string;
    code?: string;
    retryable?: boolean;
  };
}
```

不同 grader 读取不同字段：
- `contains` / `exact-match` / `regex` / `length-check` → 读 `output`
- `json-schema` → 读 `structuredOutput`
- `tool-calls` / `transcript` → 读 `trace.turns`
- `outcome-check` → 读 `outcome`
- `latency-threshold` → 读 `metrics.latencyMs`
- `token-budget` → 读 `metrics.tokenUsage`

### 5. Grader（评分器）

Grader 对 ExecutionResult 打分。函数签名：

```typescript
type Grader = (
  result: ExecutionResult,
  config: Record<string, unknown>,    // task.graders.layers[].config
) => Promise<GraderResult>;

interface GraderResult {
  pass: boolean;
  score?: number;     // 0-1 之间，WEIGHTED 策略时使用
  reason: string;
  meta?: Record<string, unknown>;
}
```

#### 内置 Grader 完整列表

| 类型 | 用途 | 核心 config |
|------|------|------------|
| `exact-match` | 精确匹配 output | `expected`, `caseSensitive?`, `trim?` |
| `contains` | output 包含/不包含字符串 | `mustInclude?`, `mustNotInclude?` (各含 `pattern`, `caseSensitive?`) |
| `regex` | output 正则匹配 | `mustMatch?`, `mustNotMatch?` (各含 `pattern`, `flags?`) |
| `json-schema` | structuredOutput 符合 JSON Schema | `schema` (标准 JSON Schema 对象) |
| `length-check` | output 长度检查 | `min?`, `max?` |
| `tool-calls` | 验证 tool 调用行为 | `required?`, `forbidden?` (各含 `tool`), `minCalls?`, `maxCalls?` |
| `transcript` | 验证对话轮次结构 | `maxTurns?`, `minTurns?`, `mustStartWith?` (`system/user/assistant`), `mustEndWith?` (`system/user/assistant`), `maxConsecutiveSameRole?` |
| `outcome-check` | 验证环境副作用 | `expect` (key-value 深度比较 outcome) |
| `latency-threshold` | 延迟阈值 | `maxMs` |
| `token-budget` | token 用量限制 | `maxTotal?`, `maxInput?`, `maxOutput?` |
| `llm-judge` | LLM 语义评分 | `dimension`, `rubric`, `contextFrom?`, `model?` (需注入 JudgeProvider) |

#### Grader 聚合策略

Task 级的 `graders.strategy` 决定多个 grader layer 如何聚合：

- **ALL**: 所有 layer 必须 pass → 最终 pass
- **ANY**: 任一 layer pass → 最终 pass
- **WEIGHTED**: 加权评分。每个 layer 必须显式提供 `weight`，以 `weight * score`（没有 `score` 时按 pass=1.0/fail=0.0）归一化后与 `passThreshold` 比较

### 6. Trial（试验）

一个 Task 执行一次 = 一个 Trial。每个 trial 的完整记录：

```typescript
interface TrialResult {
  schemaVersion: "trial-result.v1";
  taskId: string;
  runId: string;
  runName: string;
  trialIndex: number;
  execution: ExecutionResult;
  graderResults: TrialGraderResult[];   // 每个 grader layer 的结果
  aggregate: { pass: boolean; score?: number };
  timings: { startedAt: string; endedAt: string; durationMs: number };
}
```

错误处理逻辑：
- Provider 抛异常 → 分类为 system error → 跳过 grading → trial fail
- Provider 返回 `execution.error` → 跳过 grading → trial fail
- Grader 抛异常 → 标记为 `grader_exception` → trial fail
- 超时 → AbortSignal 触发 → `timeout` 错误 → **不重试**
- 其他 system error 且 `retryable !== false` → 按 `retryOnError` 重试

### 7. Run & RunSummary

一次完整的 experiment run 产出：

```typescript
interface RunManifest {
  schemaVersion: "run-manifest.v1";
  runId: string;           // UUID
  experimentName: string;
  taskSource: { adapter, ref, revision };
  datasetHash: string;     // 数据集内容 hash
  configHash: string;      // 实验配置 hash
  startedAt: string;
  completedAt?: string;
}

interface RunSummary {
  schemaVersion: "run-summary.v1";
  runId: string;
  runName: string;
  totalTasks: number;
  totalTrials: number;
  passRate: number;        // 至少 1 次 trial pass 的 task 占比
  passAtK?: number;        // 同 passRate（仅 trialsPerTask > 1 时出现）
  passHatK?: number;       // 全部 trial 都 pass 的 task 占比
  avgLatencyMs?: number;
}
```

### 8. Baseline（基线对比）

支持将某次 run 设为 baseline，后续 run 与之对比：

```typescript
interface BaselineComparison {
  baselineRunId: string;
  currentRunId: string;
  passRateDelta: number;      // 正值=进步
  passHatKDelta?: number;
  avgLatencyDelta?: number;   // 正值=变慢
  tokenBudgetBreached?: boolean;
  regressions: string[];      // 回退的 task IDs
  improvements: string[];     // 改善的 task IDs
  verdict: 'pass' | 'regressed' | 'improved';
}
```

verdict 逻辑：
- 任一 threshold 超标 → `regressed`
- 有指标改善或 task 改善 → `improved`
- 否则 → `pass`

---

## 三、架构层次

```
┌─────────────────────────────────────────────┐
│ CLI (interfaces/cli)                        │  用户入口
├─────────────────────────────────────────────┤
│ Bootstrap (create-app-core)                 │  组装依赖
├─────────────────────────────────────────────┤
│ Core API (core/api/core-api)                │  对外 API 层
├─────────────────────────────────────────────┤
│ Orchestrator (run-orchestrator)             │  运行编排
│ Trial Engine (trial-engine)                 │  单次试验执行
│ Grader Aggregate (grader-aggregate)         │  评分聚合
├─────────────────────────────────────────────┤
│ Runtime (dependency-resolver, registries)   │  依赖解析
├─────────────────────────────────────────────┤
│ Adapters                                    │  可替换的 I/O 边界
│  ├ TaskSourceAdapter (local: 文件系统)       │
│  ├ ResultStoreAdapter (local: 文件系统)      │
│  └ ObserverAdapter (console: 控制台输出)     │
├─────────────────────────────────────────────┤
│ Contracts (Zod schemas + TS interfaces)     │  类型与验证
└─────────────────────────────────────────────┘
```

**Adapter 模式**: Core 通过接口依赖 adapter，不关心具体实现。当前 v1 内置：
- `local` TaskSourceAdapter — 从 `.datasets/` 目录读取 YAML task 文件
- `local` ResultStoreAdapter — 将结果写入 `.youeval/runs/` 目录
- `console` ObserverAdapter — 将 RunEvent 输出到控制台

**Registry 模式**: Provider 和 Grader 通过 registry 注册/查找，支持动态扩展。

---

## 四、运行流程详解

`orchestrateRun()` 是核心编排流程：

1. **解析 run 配置** — 从 experiment.runs 中找到指定 runName
2. **加载数据集** — 调用 `taskSourceAdapter.resolveDataset()`（数据定位参数来自组合根注入的 adapter 实例）
3. **校验 tasks** — 验证 schema、检查 provider/grader 是否注册、校验 grader config
4. **保存 RunManifest** — 记录 run 元数据
5. **生成 trial 队列** — 每个 task × trialsPerTask
6. **并发执行 trials** — Worker 池模式，受 `maxConcurrency` 限制
   - 每个 trial: provider 执行 → grader 评分 → 持久化 → 发送事件
   - 失败重试: 仅 system error 且非 timeout 才重试
7. **聚合 RunSummary** — 计算 passRate、passAtK、passHatK、avgLatencyMs
8. **保存 RunSummary** — 持久化
9. **发出 run:completed** — 流式事件结束

事件流类型 (`RunEvent`):
- `run:started` — run 开始
- `trial:started` — trial 开始
- `trial:completed` — trial 完成（含 pass/durationMs）
- `trial:error` — trial 出错
- `run:completed` — run 结束（含 summary）

---

## 五、CLI 使用

```bash
# 执行实验
youeval run --experiment experiments/chat-agent-smoke.yaml --run smoke

# 查看历史 run 列表
youeval runs

# 查看某次 run 的 summary
youeval report <runId>

# 查看某次 run 的所有 trial 详情
youeval trials <runId>

# 设置 baseline
youeval baseline set <runId>

# 与 baseline 对比
youeval baseline compare <runId> \
  --baseline <baselineRunId> \          # 可选，默认用已设置的 baseline
  --pass-rate-drop 0.05 \              # passRate 允许下降阈值
  --pass-hat-k-drop 0.1 \             # pass^k 允许下降阈值
  --avg-latency-increase 500 \         # 平均延迟允许增加 ms
  --token-budget-breached false
```

---

## 六、数据集组织

```
.datasets/
└── chat-agent/
    └── smoke/
        ├── task-001.yaml      # 每个文件一个 task
        ├── task-002.yaml
        └── .tags.json         # 可选：tag 过滤文件
```

`local` task source 的数据集在组合根配置，例如：

```typescript
import { createAppCore } from './src/bootstrap/create-app-core.js';

const core = createAppCore({
  datasetsRoot: '.datasets',
  dataset: 'chat-agent/smoke',
  revision: 'rev-2026-02-28-001', // 可选，和 tag 二选一
  // tag: 'stable',               // 可选，和 revision 二选一
});
```

---

## 七、扩展点

### 注册自定义 Provider

```typescript
import { createAppCore } from './bootstrap/create-app-core.js';

const core = createAppCore();
// 目前需要通过 createCore() 直接注入 registry
providerRegistry.register('my-agent', async (ctx, params) => {
  // 调用你的 agent，返回 ExecutionResult
  return { schemaVersion: 'execution-result.v1', output: '...' };
});
```

### 注册自定义 Grader

```typescript
graderRegistry.register('my-custom', async (result, config) => {
  return { pass: true, reason: 'Custom check passed.' };
});
```

### 注入 LLM Judge

```typescript
createAppCore({
  judgeProvider: {
    async evaluate(input) {
      // 调用 LLM API，返回 { pass, score, reason, label }
    }
  }
});
```

---

## 八、Schema 版本

所有数据结构都有 `schemaVersion` 字段，当前均为 v1：

| Schema | Version |
|--------|---------|
| Task | `task.v1` |
| Experiment | `experiment.v1` |
| ExecutionResult | `execution-result.v1` |
| TrialResult | `trial-result.v1` |
| RunManifest | `run-manifest.v1` |
| RunSummary | `run-summary.v1` |

这为未来的向后兼容升级提供了基础。

---

## Docs Map
1. Onboarding: [AGENTS.md](./AGENTS.md)
2. Full architecture and rationale: [DESIGN.md](./DESIGN.md)
3. Contract baseline: [docs/core-contracts-v1.md](./docs/core-contracts-v1.md)
4. Implementation roadmap: [docs/core-v1-implementation-plan.md](./docs/core-v1-implementation-plan.md)
