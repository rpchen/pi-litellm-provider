## Context

PR2 的更新构建需要跟随当时的 `core/main`，但复验已提交产物必须固定使用 provenance 中的 SHA。构建输出也必须被当作 Git 交付内容校验，而不是只校验“能否重新编译”。

## Decisions

1. `scripts/build.ts` 接受显式 `--sha` 与 `--out-dir`。默认 `build:dist` 仍解析最新 `main`；复验脚本传入 provenance SHA，并把重建结果写入临时目录。
2. 新增 `scripts/verify-dist.ts`：先读取已提交 `dist/core-provenance.json`，按其中 SHA 重建临时产物，再使用 `git diff --no-index --exit-code` 比较两棵目录；有任何差异即失败。
3. `ensureCheckout` 在复制前运行 `git status --porcelain --untracked-files=all`。输出非空时拒绝缓存，避免修改后的源码进入产物。
4. CI 调用 `verify:dist`，后续 typecheck/test 继续由 provenance SHA 驱动；开发者更新 core 时仍运行 `build:dist` 后提交新的 `dist` 与 provenance。
5. 清理复验临时目录，不把缓存或重建目录纳入包；运行时仍只加载已提交 `dist`。

## Behavior Baseline

与已归档 PR2 规格及 OpenCode 行为基线无差异。本变更只收紧构建输入和交付校验。

## Failure and Cache Policy

core 获取失败时构建失败；缓存存在脏状态时构建失败并说明缓存路径。复验不访问 `main`，只使用 provenance SHA。网络发现、Pi refreshModels、凭据与 `/login`、事件 hook、pi-ai thinkingLevelMap 均不变。

## Verification

使用脱敏 LiteLLM `/v1/model/info` fixtures 运行现有行为测试；用 Pi 0.87.x 的 `pi -e ./extensions/index.ts` 验证入口；CI 等价路径运行 `verify:dist`、typecheck、test、package install 和 OpenSpec 校验。
