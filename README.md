# AEval

AEval 是一个基于 Anthropic Agent 评测理念的 Agent 评测框架

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

- `@aeval/core`：评测框架核心（Core API、contracts、runtime registry）
- `@aeval/core/tools`：可选 parser / schema 工具能力（DSL 预校验、导入检查、CI lint）
- `@aeval/graders`：内置 graders 与 `registerBuiltinGraders(...)`
- `@aeval/adapter-task-source-local`：本地 YAML 任务源适配器 `LocalTask`
- `@aeval/adapter-result-store-local`：本地结果存储适配器 `LocalStore`
- `@aeval/adapter-observer-console`：控制台观察器 `ConsoleObserver`
- `@aeval/interface-tui`：预置本地交互 TUI

### Tips
- 内置 adapters / graders / TUI 现在按包独立发布，按需安装即可；不应直接依赖 `core/domain/*`、`core/runtime/*`、`core/utils/*` 这类内部实现路径。
- 运行时接入路径默认不依赖 parser。`Tasks` adapter 返回 raw document，Core 自己在加载 suite/task 时完成解析与校验；如果调用方想在任务录入前做预检查，可按需从 `@aeval/core/tools` 使用 `parseSuiteDocument(...)`、`parseTaskDocument(...)` 等工具函数。

## Basics 示例

仓库保留一个本地可运行的通用示例：

- `examples/basics/main.ts`
- `examples/basics/providers/`
- `examples/basics/datasets/`

启动方式：

```bash
pnpm build
pnpm --filter @aeval/example-basics start
```

也可以使用根脚本：

```bash
pnpm example:basics
```
