## Why

pi（@earendil-works/pi-coding-agent）目前接入 LiteLLM 需要用户手工编辑 `~/.pi/agent/models.json`，LiteLLM 端每次新增/删除模型或调整元数据都要人工同步，且无法按当前 Key 的可见模型集合生成配置。平级仓库 `../opencode-litellm-provider` 已在 OpenCode 宿主上验证了完整的 LiteLLM 自动发现能力（模型清单、协议判定、能力映射、推理档位、轮询同步与失败降级）；本变更把这套能力移植到 pi 宿主：用户只提供 LiteLLM 地址 + 自己的 API Key，扩展自动注册 provider 与当前 Key 可见的对话模型。

## What Changes

- 新增 pi 扩展实现：在扩展工厂中调用 `pi.registerProvider("litellm", config)` 注册 id 为 `litellm`、显示名 `LiteLLM` 的 provider，使其参与启动时模型选择与 `pi --list-models`。
- 凭据与地址第一版采用 **`/login` 宿主原生登录 + 配置文件**（参考 `fgrehm/pi-ollama-cloud` 的实现）：API Key 首选经 pi 的 `/login` 命令录入（宿主存入 `~/.pi/agent/auth.json`，`/logout` 移除），`$LITELLM_API_KEY` 环境变量作为 headless 兜底，两者都经宿主统一解析链（stored credential > env）；LiteLLM 根地址经扩展自有配置文件（`~/.pi/agent/litellm.json` 全局、`.pi/litellm.json` 项目级优先）或 `LITELLM_BASE_URL` 环境变量覆盖提供。不内置任何特定 LiteLLM 地址；`oauth` 登录流程不在本变更范围。
- 宿主无关的发现核心（LiteLLM `/v1/model/info` 归一化、models.dev 记录选择与补缺、能力/价格映射、协议判定、多部署合并、阶梯截断、ModelSpec 构建与指纹）从 `../opencode-litellm-provider/src/core/` **单副本复制**进本仓 `src/core/`（pi 以 git 仓库根为 package root，用户机器上不存在平级仓库，跨仓库源码引用对 `pi install git:` 必然断裂；后续再抽独立包）。
- 协议到 pi-ai API id 的映射固化在 `src/extension/map.ts`（`chat → openai-completions`、`responses → openai-responses`、`messages → anthropic-messages`），流式委托 pi-ai 内置实现，不自研 `streamSimple`。
- 推理档位从 models.dev `reasoning_options` 生成，翻译为 pi 的 `thinkingLevelMap`（`minimal/low/medium/high/xhigh/max` → provider 值；`null` 表示不支持）。
- 发现与调用使用同一把用户 Key（宿主解析链保证：`refreshModels` 的 `context.credential` 与请求时 `getAuth` 同源）；`refreshModels(context)` 返回 `ProviderModelConfig[]` 整体替换模型列表，restore / network 两阶段分别处理宿主持久化快照回放与真实发现，`context.signal` 传递给阻塞 IO，成功结果经 `context.publish({ persist })` 交宿主 models store 持久化。
- 失败降级沿用上位仓库基线：LiteLLM 不可达保留上次结果、401/403 撤下全部模型、models.dev 失败按"无记录"继续、成功但空清单合法。

## Capabilities

### New Capabilities

- `litellm-connection`：pi 扩展如何取得 LiteLLM 地址与 API Key（`/login` + env + 配置文件），地址规范化、凭据保密、同一把 Key 用于发现与调用、Key 无效或未配置时的行为
- `model-discovery`：从 LiteLLM `/v1/model/info` 发现哪些模型、过滤非对话模型、能力/上限/价格映射与数据源优先级、models.dev 记录选择与推理档位生成、阶梯价截断、空结果与异常数据处理
- `protocol-routing`：每个模型判定为 Chat / Responses / Messages 协议的顺序与用户覆盖；协议 → pi-ai API id 与调用端点
- `change-sync`：发现结果何时刷新（pi 宿主 refreshModels 触发时机 + 扩展自有轮询）、持久化与指纹、失败降级与缓存
- `pi-integration`：扩展在 pi 宿主的注册形态（registerProvider 工厂时注册）、`ProviderModelConfig` 映射（thinkingLevelMap、cost、contextWindow 等）、`pi -e` / `pi install` 两种加载方式

### Modified Capabilities

（无——项目尚无任何 spec，全部为新建。）

## Impact

- **新增代码**：`src/core/`（复制自平级仓库的宿主无关模块，约 850 行 + `net/fetch.ts` 约 182 行；需把 `core/protocol.ts` 的 `PROTOCOL_PACKAGES` 宿主泄漏改为宿主中立输出）、`src/extension/`（工厂、map、config 读取）、`test/`（fixtures + 单测）。
- **运行时依赖**：仅既有 peer 依赖 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent`（声明 `"*"`）；不新增运行时依赖，不打包任何 SDK，流式走 pi-ai 内置实现。
- **用到的 pi 扩展 API**：`registerProvider(name, ProviderConfig)`（含 `baseUrl`/`apiKey`/`api`/`refreshModels`）；`ProviderConfig.refreshModels(context: RefreshModelsContext)` 的 `credential`/`stored`/`publish`/`allowNetwork`/`force`/`signal`（两阶段刷新与持久化）；`ExtensionContext.modelRegistry.refresh({ providers, force })`（轮询周期驱动宿主刷新）；`getAgentDir()`（定位全局配置文件）；`on("session_start")` / `on("session_shutdown")`（自有轮询的生命周期）；不使用 `oauth`、`registerCommand`、UI 通道（留后续变更）。依赖 pi 版本区间：`@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` 的 `0.87.x`（当前实跑 0.87.1；`peerDependencies` 保持 `"*"`，CI 锁 0.87.1 验证）。
- **与共享 core 的接口边界**：本仓 `src/extension/` 负责宿主映射（协议 → pi-ai api id、`ModelSpec` → `ProviderModelConfig`、凭据读取、注册时机）；`src/core/` 负责宿主无关发现（输入 LiteLLM / models.dev 响应与配置，输出 `ModelSpec[]` + 指纹），不得 import 任何 pi 包。
- **用户影响**：`~/.pi/agent/models.json` 中手工配置的 litellm provider 块可继续并存（宿主对同名 provider 以扩展注册为准需验收确认）；安装方式 `pi install git:github.com/rpchen/pi-litellm-provider`。
- **不改变**：`openspec/` 治理流程、CI/release 门禁、包冒烟脚本（仅可能随 fixtures 扩充）。