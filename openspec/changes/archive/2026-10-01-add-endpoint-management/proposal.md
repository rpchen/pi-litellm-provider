## Why

PR9 只提供 endpoint activation。用户要新增、改 Base URL、删除 endpoint 或管理某个 endpoint 的凭据时，仍必须手工改 `~/.pi/agent/litellm.json`、`auth.json` 和 `models-store.json`。本变更把 `/litellm-endpoints` 升级为全局 LiteLLM endpoint 的日常管理入口。

## What Changes

- `/litellm-endpoints` 支持：列出、Add（ID + Base URL）、Edit（仅 Base URL）、Delete（二次确认 + 完整清理）、Activate/Deactivate、查看凭据状态、Connect / Replace API Key / Disconnect。
- 只做全局 endpoint；不做项目级 endpoint、rename、load balancing、failover、高级配置 UI、通用 JSON 编辑器。
- canonical endpoint 配置仍只有全局 `litellm.json`；UI 是它的管理前端，不建立第二份配置。写入必须 non-destructive、原子、拒绝解析失败/冲突的文件。
- 凭据仍存放在 Pi 宿主的 `auth.json`（与 `/login` 同一 backend），按宿主 lock 协议写入；不自动改变 activation。
- 所有选择/确认/输入使用 Pi 的 `ctx.ui.select / confirm / input`（TUI 与 RPC 均为真实宿主对话框），不打印伪菜单。
- README 增加用户使用说明。

## Capabilities

### New Capabilities
- `endpoint-management`: `/litellm-endpoints` 的 endpoint CRUD、凭据管理、activation 和配置安全语义。

### Modified Capabilities
<!-- 无：multi-endpoint-activation 语义不变，本能力只叠加管理入口 -->

## Impact

- 使用的 Pi 扩展 API：`registerCommand`、`ctx.ui.select/confirm/input/notify`、`registerProvider/unregisterProvider`、`ctx.modelRegistry.refresh`。兼容区间仍为 Pi >=0.87.1（真实 E2E 固定 0.87.1）。
- Pi 没有公开的凭据写入 API，故直接写 `auth.json`/`models-store.json`；使用与宿主 `proper-lockfile` 相同的 `<file>.lock` 目录锁协议，见 design.md。
- 与共享 core 的边界：本变更**不修改 core**。endpoint id / URL 校验复用 core 公共入口的 `isEndpointID` / `normalizeLiteLLMURL`；配置文件、凭据、UI 全部属于 Pi 宿主边界。
- 测试隔离修复：既有测试未隔离 `~/.pi/agent`，会读取真实 activation 文件；本变更加入 bun preload 强制隔离。
