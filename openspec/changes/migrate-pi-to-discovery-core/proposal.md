## Why

Pi 当前在仓库内维护一份与独立 `litellm-discovery-core` 重复的 `src/core/`，并以源码入口直接加载扩展；这既会让两个插件的发现逻辑漂移，也使禁用安装脚本的 Git 安装无法保证可加载。PR1 已把宿主无关逻辑发布到独立 core，PR2 需要让 Pi 在每次更新构建时固定一次 core/main 的 SHA、把同一份源码编译进可交付产物，并让已安装产物与构建来源可追溯。

## What Changes

- 新增构建期 core 获取流程：解析 `litellm-discovery-core/main` 的实际 SHA，按 SHA 缓存源码，类型检查、测试和编译复用同一份输入。
- 删除 Pi 仓库中重复维护的 `src/core/`，适配层改用 core 的公开中立 API；provider 注册、凭据解析、协议到 pi-ai 的映射和轮询行为保持不变。
- 新增 `dist/` 预构建产物与扩展入口，使 Git 安装和打包在禁用 lifecycle scripts 时仍可加载；pi 宿主 SDK 继续作为 peer dependency。
- 为产物生成 core 仓库、分支和准确 SHA 的 provenance 记录；运行时不下载 GitHub、不读取本机 core 缓存。
- 增加固定 `/v1/model/info` fixtures 的行为一致性测试、干净环境构建测试、隔离安装加载测试和无 lifecycle scripts 验收。
- 更新 `AGENTS.md`、`docs/decisions.md` 与 OpenSpec，移除“复用平级 `../opencode-litellm-provider/src/core/`”的旧约定。

## Capabilities

### New Capabilities

- `shared-core-build`: 构建期按固定 SHA 获取独立 discovery core，并将可追溯、无运行时 core 依赖的产物交付给 Pi。

### Modified Capabilities

- `pi-integration`: 扩展入口、Git/打包安装和无 lifecycle scripts 安装必须从已提交的 `dist` 产物加载，同时保留现有 Pi provider 行为。

## Impact

- 影响 `package.json`、`extensions/`、`src/extension/`、`src/net/`、`scripts/`、`dist/`、测试与文档。
- 构建时访问 GitHub 获取 `rpchen/litellm-discovery-core`；运行时仅依赖 Pi 的两个 peer dependency。
- 不修改 OpenCode 仓库，不改变 LiteLLM 协议选择、模型能力推断、凭据解析或网络降级规则。
