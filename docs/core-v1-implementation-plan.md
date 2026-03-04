# YouEval Core v1 Implementation Plan (for Coding Agents)

## 1. Goal

在当前 `DESIGN.md` 与 `core-contracts-v1.md` 约束下，完成：

1. 可独立运行的 `youeval core`（contract-first、outcome-first）。
2. 最小可运行闭环所需的 reference adapters：
   - `TaskSourceAdapter`（local/reference）
   - `ResultStoreAdapter`（local/reference）
   - `Provider`（reference，可用于本地完整跑通）
   - `Observer`（optional，但提供最小 console 实现）
   - `InterfaceAdapter`: 可通过 interactive CLI 完成一次可复现评测 run，并可读取 run/trial/summary。

## 2. Done Definition (v1)

满足以下条件即视为 Core v1 完成：

1. `Task` / `Experiment` / `ExecutionResult` / `TrialResult` / `RunSummary` / `RunManifest` 契约已落地并校验。
2. 运行前通过已注册 `TaskSourceAdapter` 解析为不可变 `revision`，并记录 `datasetHash`。
3. `ProviderRegistry`、grader 执行、trial orchestration、run 聚合全部可用。
4. `ResultStoreAdapter` 完整支持 `save/get/list` 合约并可被 interface adapter 读取（v1 由 CLI 承担）。
5. Core 判定不依赖 observer 成功写入。
6. `passRate`、`pass@k`、`pass^k` 可计算并输出。
7. 有至少一套本地 reference adapters 组合可端到端执行。
8. `streamRun` 与 Interactive CLI（interface adapter 具体实现）可用，且交互模式语义与 batch 一致。
9. `compareBaseline` 支持 `passRate`/`pass^k`/`latency`/`token budget breach` 回归判定，阈值由调用方传入。

## 3. Execution Rules

1. 按 milestone 顺序推进，不实现 milestone 外能力。
2. 每完成一个任务，立即将对应 checkbox 从 `[ ]` 改为 `[x]`。
3. 仅当 milestone 下任务与验收项全部完成后，勾选 milestone 标题。
4. 若契约有变更，必须同步更新：
   - `apps/youeval/DESIGN.md`
   - `apps/youeval/docs/core-contracts-v1.md`
   - 本文件
5. 每次代码变更后，只检查变更文件/目录的类型错误。

## 4. Milestones（执行时逐项勾选）

- [x] **Milestone 0: Bootstrap & Repo Skeleton**
  - [x] 创建 `src/` 基础目录结构（`core/`, `graders/`, `adapters/`, `interfaces/`）与应用层 `providers/` 目录。
  - [x] 增加 `src/cli.ts`（interface adapter entry，转发到 `src/interfaces/cli`），替代当前仅有 `dist/cli.js` 的占位实现。
  - [x] 定义统一错误模型（contract/validation/runtime/store）。
  - [x] 补齐最小开发脚本与入口说明（保持轻量，不扩展平台细节）。
  - [x] 验收：`pnpm -C apps/youeval build` 可成功输出 `dist/cli.js`。

- [x] **Milestone 1: Core Contracts & Validation**
  - [x] 实现 v1 核心类型与 schemaVersion 常量（task/experiment/execution/trial/run-manifest/run-summary）。
  - [x] 实现 `Task DSL` 校验（provider resolvable、layers>=1、timeout>0、WEIGHTED 需 threshold、metadata strict type checks、dataset-level task.id uniqueness）。
  - [x] 实现 `Experiment DSL` 校验（taskSource/resultStore/maxConcurrency/runs 等必填）。
  - [x] 实现 schemaVersion gate（仅接受 v1，其他版本 fail fast）并对未知字段执行 fail fast。
  - [x] 为关键校验补充单测（valid/invalid fixtures）。
  - [x] 验收：非法 DSL 在 run 前失败，错误信息可定位字段。

- [x] **Milestone 2: Registries & Core Interfaces**
  - [x] 实现 `ProviderRegistry`（`register/get/has/list`，契约见 `core-contracts-v1.md` §4.3）。
  - [x] 实现 `GraderRegistry`（`register/get/has/list`，契约见 `core-contracts-v1.md` §4.4a）。
  - [x] 定义 Core 程序化 API（契约见 `core-contracts-v1.md` §4.7）：
    - [x] `createCore(deps) -> CoreApi`
    - [x] `core.runExperiment` (§4.7.1)
    - [x] `core.streamRun` (§4.7.2, v1 必选)
    - [x] `core.getRunSummary` / `core.listTrials` (§4.7.3)
    - [x] `core.setBaseline` / `core.compareBaseline` (§4.8)
  - [x] 定义并实现 adapter interfaces：
    - [x] `TaskSourceAdapter`
    - [x] `ResultStoreAdapter`
    - [x] `ObserverAdapter`（optional）
  - [x] 实现运行时依赖解析器（adapter/provider 缺失时明确报错）。
  - [x] 验收：可通过配置解析全部依赖，不存在静默降级。

- [x] **Milestone 3: Task Source Resolution (Reference Adapter)**
  - [x] 实现 local/reference `TaskSourceAdapter`（从本地 dataset 读取任务集合）。
  - [x] 实现 adapter 内部 `resolved revision` 逻辑（不可变 revision）。
  - [x] 计算并返回 `datasetHash`（用于复现与审计）。
  - [x] 在 adapter 层对非法 options / 数据集读取失败执行 fail fast。
  - [x] 验收：`resolveDataset` 返回 `source(adapter/ref/revision/fetchedAt) + tasks + datasetHash`。

- [x] **Milestone 4: Trial Engine & Run Orchestrator**
  - [x] 在 run 启动前完成 dataset resolve，失败即终止（fail fast）。
  - [x] 实现 trial 生命周期：`setup context -> execute provider -> grade -> persist -> observe`。
  - [x] 实现并发执行（`maxConcurrency`）与 trial 隔离。
  - [x] 实现 timeout + `AbortSignal` 透传到 provider。
  - [x] 实现错误语义与重试策略：
    - [x] `agent` 错误记为失败，不重试。
    - [x] 可重试 `system` 错误按 `retryOnError` 重试（`timeout` 默认不可重试）。
  - [x] 实现 run 聚合（pass/fail、score、latency、pass@k、pass^k）。
  - [x] 实现 baseline 回归判定（`passRate`/`pass^k`/`latency`/`token budget breach`，阈值由调用方传入）。
  - [x] 验收：单 trial 失败不影响其他 trial，run 可稳定完成并产出 summary。

- [x] **Milestone 5: Built-in Graders (Core Required Set)**
  - [x] `exact-match`
  - [x] `contains`
  - [x] `regex`
  - [x] `json-schema`
  - [x] `length-check`
  - [x] `tool-calls`
  - [x] `transcript`
  - [x] `outcome-check`
  - [x] `latency-threshold`
  - [x] `token-budget`（仅读取 `metrics.tokenUsage`）
  - [x] `custom`
  - [x] `llm-judge`（仅实现 judge provider 协议，不绑定具体平台；v1 E2E 使用 mock judge 验证协议正确性，不验证判定质量）
  - [x] 实现组合策略：`ALL` / `ANY` / `WEIGHTED`。
  - [x] 验收：grader 层执行结果可追踪，aggregate 可复现。`llm-judge` 仅验证协议调用链路正确。

- [x] **Milestone 6: Result Store (Reference Adapter)**
  - [x] 实现 local/reference `ResultStoreAdapter`。
  - [x] 实现写入接口：
    - [x] `saveRunManifest`
    - [x] `saveRunSummary`
    - [x] `saveTrial`
  - [x] 实现读取接口：
    - [x] `getRunManifest`
    - [x] `getRunSummary`
    - [x] `listTrials`
  - [x] 实现写入失败策略：`strict-only`（写失败即终止，不做 fallback）。
  - [x] 验收：`RunManifest.taskSource` 包含 `adapter/ref/revision/datasetHash`。
  - [x] 验收：无需外部平台即可完整保存并读取 run 全量信息。

- [x] **Milestone 7: Minimal Runnable Adapters & Interface Adapters**
  - [x] 实现 reference `Provider`（用于本地端到端跑通 execution/trace/outcome/metrics）。
  - [x] 实现 minimal `ObserverAdapter`（console）且失败不影响 pass/fail。
  - [x] 实现 CLI interface adapter（作为 interactive interface adapter 的具体实现；调用 Core API，不承载 orchestration 逻辑）：
    - [x] `run`
    - [x] `report`
    - [x] `runs`
    - [x] `trials`
    - [x] `baseline set <runId>` / `baseline compare <runId>` （基于 `core-contracts-v1.md` §4.8 定义）
  - [x] 将 CLI 查询统一走 `ResultStoreAdapter` 读取，不依赖 observer。
  - [x] 验收：执行一次 run 后，CLI 可查看实时进度与结果（summary/trials）。

- [x] **Milestone 8: E2E Verification, Docs, and Handover**
  - [x] 提供最小可运行样例数据（task + experiment）。
  - [x] 增加 smoke 场景：从 `taskSource.resolve` 到 `resultStore.read` 全链路验证（`llm-judge` 使用 mock judge，仅验证协议链路）。
  - [x] 对照 `core-contracts-v1.md` 第 8 节检查清单逐项闭环并勾选。
  - [x] 更新 `README.md` 的 quickstart（仅包含 v1 已实现能力）。
  - [x] 输出已知限制（post-v1）清单，防止 scope creep。
  - [x] 验收：新同学按文档可在本地独立跑通并复现同一 run 结果。

---

## 5. Non-Goals (for v1)

1. 不实现评测 Web UI。
2. 不绑定任何外部平台 SDK。
3. 不扩展多种远端 adapters（只保留 reference + 必要抽象）。
4. 不实现与当前 milestone 无关的 provider 业务特化能力。

---

## 6. Progress Log (Optional but Recommended)

每完成一项任务，除了勾选 checkbox，建议追加一行日志（日期 + 变更摘要）：

- `YYYY-MM-DD`: completed `Milestone X / Task Y`, notes...
- `2026-02-28`: completed `Milestone 0`, added skeleton structure, placeholder CLI, unified error model, and quickstart.
- `2026-02-28`: completed `Milestone 1`, added v1 core contracts, task/experiment validators, schema version gates, and DSL validation tests.
- `2026-02-28`: aligned `core-contracts-v1.md` and `DESIGN.md` with strict metadata type checks and unknown-field fail-fast rules for Task/Experiment DSL.
- `2026-02-28`: completed `Milestone 2`, added provider/grader registries, adapter interfaces, runtime dependency resolver, and core API surface with query/baseline coverage tests.
- `2026-02-28`: refined Milestone 2 API boundary with `createCore` composition root, runId-based result-store routing, and required baseline store contracts.
- `2026-02-28`: completed `Milestone 3`, added local TaskSourceAdapter with YAML parsing, deterministic datasetHash (SHA-256), revision resolution, adapter-level fail-fast validation, sample dataset fixtures, and 16 unit tests.
- `2026-03-03`: updated task source contract to direct `TaskSourceAdapter` instance wiring in `createCore`; moved local dataset settings to composition-root injection (`createAppCore`) and removed adapter options from Experiment DSL.
- `2026-02-28`: completed `Milestone 4`, added trial engine (timeout/AbortSignal, error semantics, retry), run orchestrator (concurrent execution, dataset resolve, manifest/summary persistence), grader aggregation (ALL/ANY/WEIGHTED), configHash computation, pass@k/pass^k metrics, and 23 orchestrator unit tests.
- `2026-03-01`: completed `Milestone 5`, added 10 built-in graders (exact-match, contains, regex, json-schema, length-check, tool-calls, transcript, outcome-check, latency-threshold, token-budget), JudgeProvider protocol with llm-judge grader factory, registerBuiltinGraders composition-root pre-registration, bootstrap wiring, and 60 grader unit tests.
- `2026-03-01`: completed `Milestone 6`, added local/reference `ResultStoreAdapter` (filesystem-based, JSON per run/trial), strict-only write failure handling, baseline persistence, bootstrap wiring with configurable `runsRoot`, and 17 unit tests.
- `2026-03-01`: completed `Milestone 7`, added reference provider (deterministic echo for E2E testing), console observer adapter, full CLI command implementations (run/report/runs/trials/baseline), `listRunIds` on ResultStoreAdapter, `listRuns` on CoreApi, and 26 new tests.
- `2026-03-01`: completed `Milestone 8`, fixed sample task data (added `params.output`), added experiment YAML, created E2E smoke test (full chain + llm-judge protocol), closed `core-contracts-v1.md` §8 checklist, updated README quickstart, documented post-v1 known limitations.
