# YouEval Core Contracts (v1)

## 1. 目标

本清单用于约束 v1 必须实现的契约，避免过度设计，同时保证后续可演进。
`Core` 独立运行语义定义为：不依赖外部平台 SDK，但必须通过 adapter 抽象与至少一组参考实现完成评测闭环。

## 2. 语义契约（冻结）

### 2.1 Anthropic 8 Blocks

1. `Task`
2. `Trial`
3. `Transcript / Trace`
4. `Outcome`
5. `Grader`
6. `Agent Harness`
7. `Eval Harness`
8. `Eval Suite`

### 2.2 YouEval Extension

1. `Provider`

### 2.3 Core Independence Semantics

1. `Core` 不直接依赖平台 SDK。
2. 运行闭环必须经过边界 adapter：`TaskSourceAdapter`、`Provider`、`ResultStoreAdapter`。
3. v1 必须提供本地/reference adapter 组合，在无外部平台时可运行。

## 3. DSL 契约（v1 必选）

### 3.1 Task DSL

Required fields:

1. `task.schemaVersion` = `task.v1`
2. `task.id` (unique in dataset revision)
3. `task.provider.id` (resolvable in `ProviderRegistry`)
4. `task.graders.strategy`
5. `task.graders.layers` (at least one)
6. `task.execution.timeoutMs` (> 0)

Optional but standardized fields:

1. `task.provider.params`
2. `task.graders.passThreshold` (required only when `strategy=WEIGHTED`; forbidden for `ALL`/`ANY`)
3. `task.graders.layers[].weight` (required only when `strategy=WEIGHTED`; forbidden for `ALL`/`ANY`)
4. `task.trackedMetrics`
5. `task.execution.retryOnError`
6. `task.execution.trialsPerTask`

Metadata fields (optional, strict type validation by Core, then pass-through to records):

1. `task.desc` — 人类可读描述
2. `task.category` — 评测类别（如 `chat-agent`, `runner`, `tool`）
3. `task.capability` — 评测能力维度（如 `board-qa`）
4. `task.tier` — 优先级层级（如 `L0`, `L1`, `L2`）
5. `task.difficulty` — 难度标签（如 `easy`, `medium`, `hard`）
6. `task.tags` — 自由标签列表
7. `task.lifecycle` — 生命周期元数据（`status`, `created`, `source`, `sourceRef`, `graduatedFrom`）

Validation rules:

1. `task.schemaVersion` must be supported.
2. `task.id` must be unique inside one immutable dataset revision.
3. `task.provider.id` must be resolvable by `ProviderRegistry`.
4. `task.graders.layers.length >= 1`.
5. `task.execution.timeoutMs > 0`.
6. Metadata baseline checks:
   - `task.tags` must be `string[]` when provided.
   - `task.lifecycle` must be `Record<string, unknown>` when provided.
   - `task.desc/category/capability/tier/difficulty` must be string when provided.
7. Unknown fields in Task/Experiment DSL objects must fail fast (no silent pass-through).

### 3.2 Experiment DSL

Required fields:

1. `experiment.schemaVersion` = `experiment.v1`
2. `experiment.name`
3. `experiment.taskSource.adapter`
4. `experiment.runs[]` (at least one `RunConfig`)
5. `experiment.maxConcurrency` (> 0)
6. `experiment.resultStore.adapter`

RunConfig structure (each element of `experiment.runs[]`):

1. `name` (required, unique within experiment) — run 的标识名
2. `overrides` (optional, `Record<string, unknown>`) — 透传到 `TaskContext.overrides`

Optional but standardized fields:

1. `experiment.trialsPerTask`
2. `experiment.timeoutMs`
3. `experiment.observers`

Validation rules:

1. `experiment.schemaVersion` must be supported.
2. `experiment.taskSource.adapter` must resolve to a registered `TaskSourceAdapter`.
3. `experiment.runs.length >= 1`.
4. `experiment.runs[].name` must be unique within the experiment.
5. `experiment.maxConcurrency > 0`.

## 4. Runtime 契约（v1 必选）

### 4.1 ExecutionResult

Required fields:

1. `schemaVersion` = `execution-result.v1`
2. `output`

Optional but standardized fields:

1. `structuredOutput`
2. `trace.turns[]`
3. `trace.turns[].toolCalls[]`
4. `trace.rawEvents[]`
5. `metrics.latencyMs`
6. `metrics.timeToFirstTokenMs`
7. `metrics.model`
8. `metrics.tokenUsage.input/output/total`
9. `outcome`
10. `error.type` (`agent` | `system`)
11. `error.message`
12. `error.code` (optional)
13. `error.retryable` (optional)

Required behaviors:

1. 多轮/工具调用场景应尽可能产出 `trace.turns`，并在 `turns[].toolCalls` 中携带工具调用信息。
2. `trace.rawEvents` 作为可选兜底审计信息，不参与主契约判定。
3. 超时必须通过 `TaskContext.signal` 传递给 Provider。

### 4.2 TaskContext

Required fields:

1. `taskId`
2. `trialIndex`
3. `runName`
4. `runId`
5. `overrides`
6. `signal`

### 4.3 Provider Contracts

1. `TaskProvider(ctx, params) -> Promise<ExecutionResult>` (`ctx.overrides` / `params` are read-only inputs)
2. `ProviderRegistry.register(id, provider)` — 注册 provider 实现
3. `ProviderRegistry.get(id) -> TaskProvider | undefined`
4. `ProviderRegistry.has(id) -> boolean`
5. `ProviderRegistry.list() -> string[]`

### 4.4 Grader Contracts

1. `Grader(result, config) -> Promise<GraderResult>`
2. `GraderResult.pass`
3. `GraderResult.reason`

### 4.4a GraderRegistry Contracts

1. `GraderRegistry.register(type, grader)` — 注册 grader 实现（内置或自定义）
2. `GraderRegistry.get(type) -> Grader | undefined`
3. `GraderRegistry.has(type) -> boolean`
4. `GraderRegistry.list() -> string[]`

Required behaviors:

1. 内置 grader 在应用组合根通过 `registerBuiltinGraders` 预注册到 `GraderRegistry`（仅声明可用实现，不代表执行）。
2. `custom` 类型 grader 通过 `register` 动态注册。
3. Task DSL 中 `graders.layers[].type` 必须在 `GraderRegistry` 中可解析，否则 fail fast。

### 4.5 Trial / Run Aggregation

1. `TrialResult.schemaVersion = trial-result.v1`
2. `RunSummary.schemaVersion = run-summary.v1`
3. `RunSummary.passRate`
4. `RunSummary.passAtK` / `passHatK` (optional)

### 4.6 TaskSourceAdapter

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

Required behaviors:

1. Resolve dataset before run starts.
2. Resolve to immutable revision before trial execution.
3. Persist `adapter/ref/revision/datasetHash` in run manifest.
4. v1 must provide at least one usable reference adapter implementation.

### 4.7 Core API Contracts

Core 通过工厂函数创建：

1. `createCore(deps) -> CoreApi`

#### 4.7.1 Batch API

1. `core.runExperiment(input) -> Promise<RunSummary>` — 批量执行，返回最终聚合结果。

#### 4.7.2 Stream API（v1 必选，interactive adapter 依赖）

1. `core.streamRun(input) -> AsyncIterable<RunEvent>` — 返回事件流。

RunEvent 联合类型：

```typescript
export type RunEvent =
  | { type: 'run:started'; runId: string; runName: string; totalTasks: number }
  | { type: 'trial:started'; taskId: string; trialIndex: number }
  | { type: 'trial:completed'; taskId: string; trialIndex: number; pass: boolean; durationMs: number }
  | { type: 'trial:error'; taskId: string; trialIndex: number; errorType: 'agent' | 'system'; message: string }
  | { type: 'run:completed'; summary: RunSummary }
```

Required behaviors:

1. 事件必须按时间顺序发射。
2. `run:completed` 必须是最后一个事件。
3. Stream API 的判定语义与 Batch API 完全一致。
4. v1 必须至少提供一个可用的 interactive interface adapter 具体实现（CLI 可作为该实现），并通过该实现消费 `streamRun`。

#### 4.7.3 Query API

1. `core.getRunSummary(runId) -> RunSummary | null` — 通过 `ResultStoreAdapter` 读取。
2. `core.listTrials(runId) -> TrialResultRecord[]` — 通过 `ResultStoreAdapter` 读取。
3. `core.listRuns() -> RunSummaryRecord[]` — 聚合已注入 `ResultStoreAdapter` 的 run summaries。

Required behaviors:

1. Query API 按 `runId` 在已注入的 `ResultStoreAdapter` 集合中自动定位目标 store。
2. 当 `runId` 在多个 store 同时命中时，必须 fail fast。
3. `core.getRunSummary` 在未命中时返回 `null`。
4. `core.listTrials` 在未命中时返回空数组。
5. `core.listRuns` 仅返回存在 run summary 的 `runId`。
6. `core.listRuns` 若发现同一 `runId` 在多个 store 命中，必须 fail fast。

### 4.8 Baseline Contracts

#### 4.8.1 操作语义

1. `core.setBaseline(runId)` — 将指定 run 标记为基线（写入 ResultStoreAdapter）。
2. `core.compareBaseline(currentRunId, baselineRunId?) -> BaselineComparison` — 比较当前 run 与基线。
3. `baselineRunId` 未传入时，使用当前 run 所在 store 的基线指针。
4. `runId` 路由冲突（多个 store 同时命中）必须 fail fast。

#### 4.8.2 BaselineComparison 结构

```typescript
export interface BaselineComparison {
  baselineRunId: string
  currentRunId: string
  passRateDelta: number       // currentPassRate - baselinePassRate
  passHatKDelta?: number      // currentPassHatK - baselinePassHatK
  avgLatencyDelta?: number    // currentAvgLatency - baselineAvgLatency
  tokenBudgetBreached?: boolean // 当前 run 是否触发 token budget breach
  regressions: string[]       // 回归的 taskId 列表
  improvements: string[]      // 改善的 taskId 列表
  verdict: 'pass' | 'regressed' | 'improved'
}
```

#### 4.8.3 回归判定规则

1. `passRate` 下降超过阈值 → `regressed`。
2. `pass^k` 下降超过阈值 → `regressed`。
3. `avgLatency` 上升超过阈值 → `regressed`。
4. 发生 `token budget breach`（若调用方提供该判定条件）→ `regressed`。
5. 阈值由调用方传入，Core 不硬编码默认值。
6. 调用方提供的阈值必须为有限且非负的数字（`>= 0`）。

### 4.9 Runtime Error Semantics

1. `error.type=agent` means behavior failure and counts as eval failure.
2. `error.type=system` means system failure and retry is decided by policy plus `error.retryable`.
3. `error.code=timeout` must be treated as non-retryable in v1.
4. Retry applies only to retryable `system` errors.

## 5. Storage 契约（v1 必选）

### 5.1 ResultStoreAdapter

Required methods:

1. `saveRunManifest`
2. `saveRunSummary`
3. `saveTrial`
4. `getRunManifest`
5. `getRunSummary`
6. `listTrials`
7. `listRunIds`
8. `saveBaseline`
9. `getBaselineRunId`

### 5.2 Manifest / Records

RunManifest required fields:

1. `schemaVersion` = `run-manifest.v1`
2. `runId`
3. `experimentName`
4. `taskSource.adapter`
5. `taskSource.ref`
6. `taskSource.revision`
7. `datasetHash` — dataset 内容的确定性哈希，用于复现审计
8. `configHash` — experiment 配置的确定性哈希（见 §5.5）
9. `startedAt` (ISO 8601)

RunManifest optional fields:

1. `gitSha` — 运行时 git commit，无 git 环境时可省略
2. `completedAt` (ISO 8601)

Aggregation records:

1. `RunSummaryRecord` = `{ runId, summary: RunSummary }`
2. `TrialResultRecord` = `{ runId, trial: TrialResult }`

### 5.3 Write Failure Policy

1. `strict-only`: terminate run on write failure.
2. v1 does not define any fallback write path (including fallback-to-local).

### 5.4 Adapter Scope

1. v1 mandatory: at least one reference `ResultStoreAdapter` implementation
2. post-v1 optional: additional `ResultStoreAdapter` implementations
3. optional extension: large artifact split storage

### 5.5 configHash 计算规则

`configHash` 用于判定两次 run 是否使用了相同的评测配置，保证可复现性。

输入范围（按 key 字典序序列化后取 SHA-256）：

1. `experiment.schemaVersion`
2. `experiment.taskSource.adapter`
3. `experiment.runs[]`（含每个 RunConfig 的 `name` + `overrides`）
4. `experiment.trialsPerTask`
5. `experiment.maxConcurrency`
6. `experiment.timeoutMs`
7. `experiment.resultStore.adapter`

不参与 configHash 的字段：

1. `experiment.name`（纯标识，不影响执行行为）
2. `experiment.observers`（不影响 pass/fail 语义）

## 6. Observer 契约（可选）

1. Observer adapter is optional and not part of pass/fail semantics.
2. Core pass/fail must not depend on observer write success.
3. Observer notification must be best-effort with bounded wait time to avoid run stall.

## 7. 版本演进规则

1. Any breaking contract change requires new schema version.
2. v1 loader must reject unsupported schema versions.
3. Cross-version comparison must be explicit and auditable.

## 8. 实施检查清单

- [x] Task/Experiment schema version validation implemented.
- [x] ProviderRegistry (`register/get/has/list`) implemented.
- [x] GraderRegistry (`register/get/has/list`) implemented; built-in graders pre-registered in composition root.
- [x] Task DSL `graders.layers[].type` validated against GraderRegistry.
- [x] Experiment `runs[]` validated (`name` unique, at least one RunConfig).
- [x] Task source resolution to immutable revision before run starts.
- [x] `token-budget` grader reads only `metrics.tokenUsage`.
- [x] Reference ResultStore fully usable without external platform.
- [x] RunManifest captures full required fields (`runId/experimentName/taskSource/datasetHash/configHash/startedAt`).
- [x] `configHash` computed per §5.5 rules.
- [x] Core pass/fail does not depend on observer write success.
- [x] CI reads summary/trials via `ResultStoreAdapter` only.
- [x] Query API `listRuns` implemented via `ResultStoreAdapter` aggregation with duplicate runId fail-fast.
- [x] Baseline `setBaseline`/`compareBaseline` implemented per §4.8.
- [x] Baseline regression evaluation covers `passRate`/`pass^k`/`latency`/`token budget breach` with caller-provided thresholds.
- [x] `streamRun` implemented and consumed by at least one interactive interface adapter implementation (v1 can use CLI).
- [x] `llm-judge` protocol verified with mock judge (quality verification is post-v1).
