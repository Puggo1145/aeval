# 发布到公共 npm

所有发布包使用 npm scope `@aeval/*`，例如 `@aeval/core` 和
`@aeval/graders`。这些包发布到公共 npm registry，而不是 GitHub
Packages。

## 包配置

各发布包 `package.json` 需要具备：

- `name: "@aeval/<pkg>"`
- `publishConfig.access: "public"`
- `repository.url: "git+https://github.com/aeval/aeval.git"`
- `repository.directory: "packages/<pkg-dir>"`

仓库不需要提交 `.npmrc`。本地发布使用当前 npm 登录态；CI 发布使用
`NODE_AUTH_TOKEN`。

## 发布脚本

发布全部 `packages/*`：

```bash
pnpm publish:npm
```

只发布 `core` 和 `graders`：

```bash
pnpm publish:npm:core-graders
```

两个脚本都会传 `--access public`，这是 scoped npm 包公开发布所必需的。

## 本地发布

首次发布前，确认你拥有 npm 上的 `@aeval` organization/scope，并且当前账号有发布权限。

```bash
npm login
pnpm install
pnpm build
pnpm publish:npm:core-graders
```

如果要一次性发布所有包：

```bash
pnpm publish:npm
```

## GitHub Actions 发布

仓库的 publish workflow 使用 `secrets.NPM_TOKEN` 发布到
`https://registry.npmjs.org`。在 GitHub 仓库 secrets 中添加：

- `NPM_TOKEN`: npm access token，需有发布 `@aeval/*` 包的权限。

手动触发 workflow 时：

- 默认 `package_set=core-graders`，只发布 `@aeval/core` 和 `@aeval/graders`。
- 选择 `package_set=all`，发布 `packages/*` 下全部发布包。

## 安装

因为包发布在公共 npm registry，消费者不需要配置 `.npmrc`：

```bash
pnpm add @aeval/core @aeval/graders
```
