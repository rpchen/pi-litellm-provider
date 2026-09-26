## Context

当前 Pi 适配层的 provider、凭据、轮询和 `src/net/fetch.ts` 属于本仓库；宿主无关的 `src/core/*` 与 PR1 生成的 `litellm-discovery-core` 内容一致。`package.json` 仍把 `extensions/index.ts` 与 `src` 作为发行内容，运行时由 jiti 直接解释 TypeScript，因此 Git 安装在禁用 lifecycle scripts 时没有可复验的独立产物。详见 proposal.md 与变更规格。

## Goals / Non-Goals

**Goals:**

- 每次更新构建解析一次 core `main` SHA，并让 typecheck、test、build 共用这个 SHA。
- 删除受 Git 管理的 `src/core/`，通过构建缓存提供同一份 core 源码给适配层和测试。
- 生成并提交 `dist`，使 `extensions/index.ts` 只转发到包内编译产物；产物附带 core provenance。
- 用固定 `/v1/model/info` 与 models.dev fixtures 验证迁移前后模型结果一致，并在隔离目录加载打包内容。
- 保留 `registerProvider`、`refreshModels`、`/login` 凭据链、事件 hook、协议映射和网络降级行为。

**Non-Goals:**

- 本 PR 不修改 `opencode-litellm-provider`，不修改独立 core 的代码或发布方式。
- 不把 core 发布为 Pi 的运行时依赖，不在插件启动时下载或编译 core。
- 不改变 LiteLLM 协议选择、模型能力推断、推理档位语义、地址/Key 配置优先级或轮询策略。
- 不将 core 源码复制成新的受 Git 管理副本；`src/core/` 只允许作为脚本生成的忽略缓存。

## Decisions

### 1. 以 Git SHA 为构建输入，缓存源码而非运行时依赖

构建辅助脚本调用 `git ls-remote https://github.com/rpchen/litellm-discovery-core.git refs/heads/main`，更新构建得到完整 40 位 SHA；指定 `CORE_SHA` 或 provenance SHA 时只使用该值。源码缓存放在 `.tmp/discovery-core/<sha>`，脚本校验 `git rev-parse HEAD` 后把 `src/core` 生成到被忽略的工作区缓存，typecheck、Bun 测试和 TypeScript 编译均从该生成目录读取。这样一次构建不会混用不同提交，也没有手工维护的第二份 core。

备选方案是把 core 作为 Git/npm 运行时依赖：它会让安装机器继续解析远端版本，无法满足“产物固定 SHA 且运行时不下载”的边界，因此不采用。

### 2. 使用相同源码生成 `dist`，扩展入口保持 Pi 兼容

新增 `tsconfig.build.json`，以 `src` 为 rootDir、输出 `dist`；`scripts/build.ts` 先准备 core、清理并编译，再写入 `dist/core-provenance.json`。`extensions/index.ts` 保留 Pi 识别的入口路径，但只 `export` `../dist/extension/index.js`，因此本地 `pi -e ./extensions/index.ts` 与 Git 安装都走同一份 JS 产物。`package.json.files` 改为包含 `extensions`、`dist`、README 和 LICENSE，不把生成缓存或源码当作运行时交付内容。

复验已有产物时，脚本读取 `dist/core-provenance.json` 的 SHA 并传给 core 准备步骤；更新构建只有在显式使用更新模式时才重新解析 `main`。

### 3. provenance 作为生成文件提交

`dist/core-provenance.json` 使用稳定字段：`repository`、`branch`、`sha`。其中仓库、分支和 SHA 来自构建输入；不写入构建时间，避免相同 SHA 的产物因时间戳发生无关差异。CI 和 `scripts/test-package.ts` 检查该文件存在、SHA 为 40 位十六进制，并与当前准备的 core SHA 相同。

### 4. 适配层仍负责网络与 Pi 映射

core 只提供 `buildModelSpecs`、地址/部署归一化、协议判定、能力/价格/上下文映射、models.dev 记录选择和变体生成。Pi 继续在 `src/extension/discovery.ts` 负责 `refreshModels` 的 restore/network 两阶段、LiteLLM 与 models.dev 请求、发布持久化、错误降级和轮询触发；`src/extension/map.ts` 将中立 `chat` / `responses` / `messages` 分别映射为 pi-ai 内置的 `openai-completions` / `openai-responses` / `anthropic-messages`。

models.dev 失败时仍返回 LiteLLM-only 结果，缓存有效期和重试窗口保持现有实现；LiteLLM 网络/解析/429/5xx 失败保留上次清单，401/403 撤下清单，成功空结果持久化。刷新仍由宿主 `refreshModels`、`session_start` 后的轮询和 `session_shutdown` 清理触发。Pi thinkingLevelMap 仍把 core 的 effort `none` 映射到 `off`，Messages budget 只暴露 `high`/`max`，预算数值由 Pi 宿主推导。

### 5. 行为差异清单

- **源码来源：平级仓库副本 → 构建期独立 core SHA。** 理由：消除重复维护并支持 PR1 的单一来源。
- **入口：jiti 直接解释 `src` → `extensions/index.ts` 转发到提交的 `dist`。** 理由：禁用 lifecycle scripts 的 Git 安装仍需完整产物。
- **发行清单：包含 `src` → 包含 `dist` 与 provenance。** 理由：安装者不需要源码、平级仓库或构建工具。
- **运行时依赖：可见源码路径 → 仅相对产物模块与 Pi peer dependency。** 理由：避免安装后访问本机缓存或 GitHub。
- **协议、模型、凭据、降级和刷新语义：无变化。** 理由：本 PR 只替换 core 来源与交付形态。

## Risks / Trade-offs

- [Risk] 构建环境无法访问 GitHub → [Mitigation] CI 在构建前失败并给出获取错误；复验已有产物可用 provenance SHA 与已存在缓存，运行时用户不受网络获取影响。
- [Risk] 忽略缓存被误当作可编辑源码 → [Mitigation] 脚本每次按 SHA 覆盖生成并在文档注明 `src/core/` 仅为生成缓存；Git 状态检查确认没有受跟踪 core 文件。
- [Risk] 提交的 `dist` 与源码不一致 → [Mitigation] CI 运行 `build`、`typecheck`、`bun test`、`test:package`，并检查产物入口和 provenance；PR 只接受构建后干净的工作树。
- [Risk] Pi peer dependency API 变动 → [Mitigation] 保持现有 `*` peer 约定，以当前 0.87.x 开发依赖执行真实 `pi -e` 加载验收。

## Migration Plan

1. 在功能分支创建 OpenSpec 变更，实施构建辅助脚本、入口/清单调整、core 删除、测试和文档更新。
2. 用 core `main` 当前 SHA 执行 `bun run typecheck`、`bun test`、`bun run build:dist`、`bun run test:package` 和真实 Pi 加载检查，提交 `dist` 与 provenance。
3. 若需要回滚，恢复上一版 Pi 提交即可；用户已安装的旧产物不访问新 core，core 后续更新不会改变旧产物。
4. PR 仅提交到 `rpchen/pi-litellm-provider`，不自动合并；OpenCode 迁移留给 PR3。

## Open Questions

无。构建更新与既有产物复验的输入边界、发行文件和验收命令已在规格与本设计中确定。
