## Context

动机与能力划分见 proposal.md。本仓库脚手架已就位：`extensions/index.ts` 是薄入口，`src/extension/index.ts` 注册 provider（`baseUrl`/`apiKey` 空串占位），`src/extension/map.ts` 固化了协议 → pi-ai API id 映射（已有测试），`openspec/specs/` 为空。行为基线来自 `../opencode-litellm-provider`（其 `docs/decisions.md` 与 `openspec/specs/` 是权威来源）。

对设计有约束的 pi 宿主事实（从 `@earendil-works/pi-ai@0.87.1` 与 `@earendil-works/pi-coding-agent@0.87.1` 的 dist 源码核实）：

- **注册 API**：`pi.registerProvider(name, config)`；`ProviderConfig` 支持 `name` / `baseUrl` / `apiKey` / `api` / `models` / `refreshModels` / `headers` / `authHeader`。工厂内注册立即生效，参与启动模型选择与 `pi --list-models`。
- **refreshModels 机制**（`pi-ai/dist/models.js` + `pi-coding-agent/dist/core/model-runtime.js`）：宿主在启动、`refreshModelCatalogs`（模型选择器打开、TUI 启动后台刷新）、`/reload` 等时机调用 provider 的 `refreshModels(context)`。`context` 含 `credential`（解析后的凭据，OAuth 会先刷新）、`stored`（持久化目录快照）、`publish`、`allowNetwork`、`force`、`signal`。刷新分两阶段：先 `allowNetwork: false`（恢复 `stored`），再 `allowNetwork: true` 走网络。返回值整体替换该 provider 的模型列表。**宿主没有周期性轮询**——这是与 OpenCode 插件的本质差异，扩展必须自建轮询（见 D5）。
- **凭据**：`apiKey` 字段支持字面量、`$ENV_VAR`/`${ENV_VAR}` 环境变量插值、`!command`；宿主把 provider 的 apiKey auth 写入/读取 `~/.pi/agent/auth.json`（经 `CredentialStore`），`refreshModels` 的 `credential.key` 是解析后的值。`getAuth` 在请求时解析。宿主 `check`/`resolve` 会验证 provider 是否"已配置"——**key 引用解析不到（环境变量未设）时 provider 视为未配置，模型不出现在选择器**，这个宿主行为正好是我们的"未连接不注册模型"防线的一部分。
- **baseUrl 层级**（`provider-composer.js` 的 `applyExtension`）：模型级 `baseUrl ?? provider 级 baseUrl`；无任何 baseUrl 时注册报错。**pi-ai 各 API 客户端直接拼 `model.baseUrl + path`**：`openai` SDK 拼 `/chat/completions`、`/responses`；`@anthropic-ai/sdk` 拼 `/v1/messages`。因此 provider baseUrl 必须带 `/v1`（`http://host:4000/v1`），与 OpenCode 侧原生包要求一致。
- **协议实现**：pi-ai 按模型的 `api` 字段逐模型选择实现（`getApiProvider(model.api)`），`KnownApi` 含 `openai-completions`、`openai-responses`、`anthropic-messages`。流式委托内置实现（符合 `docs/decisions.md` 既定决策）。
- **thinkingLevelMap**（`pi-ai/dist/types.d.ts`）：`Partial<Record<"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max", string | null>>`。各 API 实现读取它把 pi 档位映射为 provider 值：completions 走 `reasoning_effort`（默认透传档位名）；responses 走 `reasoning.effort`；anthropic-messages 有两条路径——`compat.forceAdaptiveThinking: true` 时走 effort（映射缺失默认 low/medium/high），否则走 budget_tokens（`adjustMaxTokensForThinking`）。**off 的语义**：`off: null` 表示"该模型不能关思考"；缺失 key 用 provider 默认。
- **models.json**：用户自有配置层（`~/.pi/agent/models.json`），宿主对扩展注册的同名 provider 应用 `applyModelsJson`（modelOverrides 是最顶层用户覆盖层）。扩展不读写它。
- **生命周期**：pi 官方指引"不要在工厂里起 timer/socket"；长生命周期资源放 `session_start`（reason: startup/reload/new/resume/fork），在幂等 `session_shutdown` 清理。
- **打包边界**：pi 把 git 仓库根当 package root，jiti 直接加载 TS，无构建产物；用户机器上不存在平级仓库。
- **同类参考实现**：`fgrehm/pi-ollama-cloud`（pi 官方 packages 页收录）——`apiKey: "$OLLAMA_API_KEY"` + `/login` 录入、双层配置文件（`~/.pi/agent/ollama-cloud.json` 全局 + `.pi/ollama-cloud.json` 项目级，env 最高覆盖）、`refreshModels` 两阶段（restore 返回 `context.stored`，network 抓新后 `publish({persist})` 持久化、4h 冷却）。本设计的 Key / 配置文件 / 刷新机制以它为模板，`getAgentDir()` 为宿主公开导出（本仓 node_modules 已核实）。

LiteLLM 实测事实（v1.97.0，继承上位仓库 design）：`/v1/model/info` 按用户 Key 过滤返回真实部署；`/v1/models` 与 `/model_group/info` 会列出白名单残留名；`supported_endpoints` 是官方端点能力字段但覆盖率低；阶梯价两种表达（`*_above_<N>k_tokens` 字段与 `tiered_pricing` 数组）；部署的 `litellm_params` 含上游 `api_base` 等敏感字段。

## Goals / Non-Goals

**Goals:**
- 任意 LiteLLM 部署零配置接入：env 变量或配置文件提供地址 + Key。
- 发现逻辑保持宿主无关：`src/core/` 只依赖自定义类型与全局 fetch，可用固定样本完整单测。
- 对宿主 API 的调用集中在 `src/extension/` 薄适配层。
- 与上位仓库的行为差异全部显式列出并有理由。

**Non-Goals:**
- 不做 `oauth` 登录流程（LiteLLM 是 API Key 语义，`oauth` 的 refresh token 模型不匹配；留后续变更）。
- 不做 LiteLLM 管理功能。
- 不自研流式实现，不打包任何 SDK。
- 不做模型可用性探测（不发试探请求）。
- 不做 TUI 结果卡片 / 审计导出命令 / 对话反馈（上位仓库的 model-audit-export / conversation-feedback 能力不在本次移植范围）。
- 不发布 npm；发行沿用现有 CI/release 门禁，本变更不动 distribution。

## Decisions

### D1. 模块划分：复制 core + 薄宿主适配层

```
src/
  core/               # 从 ../opencode-litellm-provider/src/core/ 复制（单副本语义：pi 侧唯一副本，宿主无关）
    litellm.ts        # LiteLLM 响应类型、地址规范化、部署聚合
    protocol.ts       # 协议判定（纯函数）；PROTOCOL_PACKAGES 宿主泄漏改为输出中立 Protocol 值
    capabilities.ts   # 能力 / 上限 / 模态 / 价格映射、多部署合并、阶梯截断
    modelsdev.ts      # models.dev 记录选择、家族表、variants 数据生成
    build.ts          # 组合：deployments + catalog + options → ModelSpec[]
  net/
    fetch.ts          # 带超时 GET、错误分类、Key 脱敏（同上复制）
  extension/
    config.ts         # 连接信息与可选配置的解析（env + 配置文件）
    map.ts            # Protocol → pi-ai api id；ModelSpec → ProviderModelConfig（含 thinkingLevelMap）
    index.ts          # 扩展工厂：registerProvider + session_start/shutdown 轮询生命周期
```

`core/` 与 `net/` 不 import 任何 pi 包；`extension/` 是唯一的宿主映射层。
- 备选（跨仓库源码引用 `../opencode-litellm-provider/src/core/`）：被用户否决——pi 以 git 仓库根安装，用户机器没有平级仓库，`pi install git:` 后运行时 import 必断。
- 备选（先抽 `litellm-model-discovery` 独立包）：被用户否决——首次跑通周期长；core 抽包时机可晚于首次跑通（`docs/decisions.md` 的既定判断）。
- "复制"与 AGENTS.md"单副本共享、不复制两份"的张力说明：该规则约束的是**本仓库内**不出现第二份 core（如 `src/core/` 与 `vendor/core/` 并存）。跨仓库物理复制是 pi 打包边界的硬约束，本设计把"唯一可改副本"定为 pi 侧 `src/core/`，上位仓库仍是 OpenCode 侧权威；抽包后归一。

### D2. 连接信息：`/login` + env + 配置文件（参考 `fgrehm/pi-ollama-cloud`）

Key 与地址走两条独立通道，均以 pi 生态的原生机制为骨架：

**Key**：`registerProvider` 的 `apiKey` 传 `"$LITELLM_API_KEY"` 引用，宿主统一解析。宿主解析顺序（pi-ai `auth/resolve` 契约 + `composeApiKeyAuth` 源码核实）：`/login` 存入 auth.json 的 stored credential **优先**，无 stored 时才回落环境变量。因此：
- 交互用户：`/login` → 选 LiteLLM → 粘贴 Key（宿主为任何注册了 apiKey 的扩展 provider 自动生成此流程，与内置 provider 同款 UX；`/logout` 移除）；
- headless / CI / 验收：`LITELLM_API_KEY` 环境变量；
- 发现与调用同 Key 由宿主保证：`refreshModels(context.credential)` 与请求时 `getAuth` 走同一条解析链。
- AGENTS.md 的真实验收凭据（`opencode-litellm-config-sync/.env` 的 `LITELLM_BASE_URL`/`LITELLM_API_KEY`）在这套机制下零改动可用。

**地址**：LiteLLM 自托管、人人不同（pi-ollama-cloud 写死 `https://ollama.com` 对它成立、对我们不成立），采用它的配置文件机制承载：

```jsonc
// ~/.pi/agent/litellm.json（全局）   .pi/litellm.json（项目级，优先）
{
  "baseUrl": "http://litellm.example:4000",  // 必填（env 可替代）
  "pollInterval": 300,                        // 可选，秒，默认 300，下限 30
  "contextTierCap": true,                     // 可选，默认 true
  "protocolOverrides": { "glm-5.3": "chat" }  // 可选
}
```

解析顺序：`LITELLM_BASE_URL` env > 项目 `.pi/litellm.json` > 全局 `~/.pi/agent/litellm.json`。全局路径经宿主公开导出的 `getAgentDir()` 定位（pi-ollama-cloud 同款）。容错同 pi-ollama-cloud 的 `sanitizeConfig`：未知键丢弃、类型错忽略、JSON 损坏不崩、解析失败回落默认值。
- 为什么不用 `registerFlag`：CLI 选项每次启动都要敲，不满足"填一次持续生效"。
- 为什么不用 `oauth`：LiteLLM 无 OAuth 语义（既定决策）；`/login` 的 api-key 流程已覆盖交互录入需求。
- 未连接（缺地址；Key 由宿主判定未配置）时的注册形态：**仍注册 provider**（`apiKey: "$LITELLM_API_KEY"`，宿主解析不到即未配置，模型不可见），`models: []` + `refreshModels` 未连接时返回 `[]` 不发请求。`--list-models` 不报错，`/login` 后无需重启。

### D3. 协议 → pi-ai 映射与调用端点

`src/extension/map.ts` 的 `PROTOCOL_API`（已固化并有测试）：`chat → openai-completions`、`responses → openai-responses`、`messages → anthropic-messages`。逐模型写 `api` 字段；provider 级不设 `api`（模型级必须给，`applyExtension` 对每个模型取 `definition.api ?? config.api`）。

provider `baseUrl` = 规范化根地址 + `/v1`。pi-ai 客户端拼路径（核实自 SDK 源码）：completions → `{baseUrl}/chat/completions`；responses → `{baseUrl}/responses`；messages → `{baseUrl}/v1/messages`（`@anthropic-ai/sdk` 自带 `/v1/messages`，注意 pi-ai 侧 baseUrl 传的是 `model.baseUrl` 原样，所以 messages 不需要我们再补 `/v1`——统一给 provider baseUrl 带 `/v1` 后三种端点都正确：`/v1/chat/completions`、`/v1/responses`、`/v1` + SDK 的 `/v1/messages`）。**风险**：`@anthropic-ai/sdk` 拼接结果为 `{根}/v1/v1/messages`——不对，SDK path 是 `/v1/messages?beta=true`，`buildURL` 为 `baseURL + path`，所以 messages 模型必须用**不带 `/v1` 的根地址**。**决定：逐模型设 `baseUrl`**——chat/responses 模型给 `{根}/v1`，messages 模型给 `{根}`，map.ts 集中此差异，spec 的"调用端点"要求由此满足。实施时用真实 Messages 部署验证（tasks 4.2），若 LiteLLM 侧路径不同以实测为准并更新本设计。

### D4. 推理档位 → thinkingLevelMap

`ModelSpec` 的 variants（core 输出，宿主中立）在 `map.ts` 翻译为 pi 的 `thinkingLevelMap`。pi 的档位集固定为 `off/minimal/low/medium/high/xhigh/max`，规则（核实自 pi-ai `models.js` 的 `getSupportedThinkingLevels` 与各 API 实现）：

- **effort 类（chat / responses）**：记录的每个取值直接映射到同名 pi 档位（`none → off`）；**未出现在记录中的档位显式置 `null` 隐藏**（官方内置模型同款写法，如 `minimal: null`）。例如 values `[none, low, medium, high, xhigh]` → `{ off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null }`。`reasoning: true`。请求侧由 pi-ai 写入 `reasoning_effort`（chat）/ `reasoning.effort`（responses）。
- **budget_tokens 类（仅 Messages 协议）**：生成 `high`；记录声明最大值时额外生成 `max`。两者在 pi 的预算路径下按档位名映射预算数值——**pi 从自身的 `thinkingBudgets` 表推导**（`adjustMaxTokensForThinking`），`thinkingLevelMap` 的值不参与数值计算（源码核实）。因此记录的 64000 预算无法经注册配置注入。`off` 不写键（可选用，选择后 pi 发送 `thinking: {type: "disabled"}`）；`minimal/low/medium` 与未声明的 `max` 置 `null` 隐藏。`reasoning: true`。
- **toggle 类 / 无 reasoning_options / 无选中记录**：`reasoning: false`，不写 `thinkingLevelMap`。
- **与上位仓库差异**：variants（档位列表 + 每档 settings）被 pi 的固定档位集取代；OpenCode 侧 budget 档位的显式 token 数值（16000 / 记录声明的 64000）在 pi 侧无法保留——档位可选用性保留，数值改由宿主推导。**这是宿主 API 的硬限制**（`ProviderModelConfig` 无 per-model thinkingBudgets 入口），不是实现取舍。design 规则表在 map.ts 注释中固化。

### D5. 刷新：宿主两阶段 refreshModels + 扩展轮询驱动宿主刷新

宿主在启动 / `/model` 打开 / `pi update --models` / `/reload` 时调用 provider 的 `refreshModels(context)`，每次调用分两阶段（pi-ai `models.js` 源码核实，`pi-ollama-cloud` 同款处理）：

1. **restore 阶段**（`allowNetwork: false`）：返回 `context.stored.models`（宿主 FileModelsStore 里的上次持久化清单）——跨会话回放，重启即有模型可用。
2. **network 阶段**（`allowNetwork: true`，且宿主解析出凭据才进入）：执行真实发现（读地址配置 → 用 `context.credential.key` 请求 LiteLLM → 可选 models.dev → 构建 → 指纹比较）→ 成功且非空时 `context.publish({ persist: { models, checkedAt } })` 持久化并返回新清单。

时效性（LiteLLM 端变更在一个轮询间隔内跟随）由扩展自建轮询补足，但轮询**不再自己发请求**，而是调用 `ctx.modelRegistry.refresh({ providers: ["litellm"], force: true })`（`ModelRegistry.refresh` 公开 API，`ModelsRefreshOptions.providers` 限定 provider），让宿主走同一条两阶段路径：

- `session_start` 后启动轮询循环（默认 300s，下限 30s）；`session_shutdown` 幂等清理（`/reload` safe）。
- 轮询与用户触发的刷新共用同一 in-flight 发现（最多一个实例，新触发合并等待）。
- 指纹相同的成功结果跳过 `publish`，避免无谓写入。
- **空清单要持久化**（区别于 pi-ollama-cloud 的 guard）：本项目的 spec 把"成功但过滤后没有对话模型"定义为合法终态，必须撤下模型且**跨重启保持撤下**；若不持久化，restore 阶段会回放旧清单形成回归。pi-ollama-cloud 保留 guard 是因为它的空清单来自部分失败，我们的空清单是明确成功结果。
- 与 pi-ollama-cloud 的差异：它不需要自建轮询（云端目录变更频率低，用户开 `/model` 自然刷新），LiteLLM 基线要求 5 分钟跟随，必须轮询。
- **持久化决策修正**（对比上一稿）：原"不启用 persist、怕 env 地址跨环境不成立"的顾虑被推翻——models store 按 provider id 持久化的是模型清单（含每模型 baseUrl），跨会话同机场景完全成立；地址换了之后 restore 先回放旧清单、network 阶段立即用新地址校正，最终一致。
- 备选（指纹变化时直接重新 `registerProvider`）：被否决——宿主对 refreshModels 的返回值本身就是"整体替换模型列表"，重注册是多余的并且会打断 merge 语义；轮询驱动宿主刷新才是原生路径。

### D6. 失败降级与缓存（对应 specs/change-sync）

继承上位仓库 D8 分类表，按 pi 两阶段语义适配：

| 情况 | restore / network 阶段行为 |
|---|---|
| 未连接（缺地址） | 返回 `[]`，不发请求 |
| 网络错误 / 超时 / 429 / 5xx / 解析失败 / 3xx | **throw**（宿主 catch 计入 refresh errors，保留旧清单与持久化快照），warn，等下周期 |
| 401 / 403 | 返回 `[]` 撤下模型并持久化空清单（跨重启保持撤下），error"Key 无效或无权限"；restore 阶段不受影响 |
| 404 | 回退试 `/model/info`（不带 `/v1`）；仍 404 按网络错误处理并提示检查地址 |
| 成功但空清单 | 合法状态：内存撤下并持久化空清单（见 D5）；下次成功发现后新清单正常持久化 |
| 单部署异常 | 字段按未提供 / 跳过该部署 |
| models.dev 失败 | 按无记录继续；60s 退避重试；成功缓存 6h（进程内） |

关键机制（`refreshModels` 抛错 vs 返回空的区别，pi-ollama-cloud 源码同款语义）：throw 让宿主保留上次清单（跨会话也能保留，因为持久化快照没被破坏）；返回 `[]` 是主动撤下。401/403 要求"撤下"语义所以走返回空，其余失败要求"保留"所以走 throw。restore 阶段无论何时都返回 `context.stored`（有则回放）。
超时：LiteLLM 15s；models.dev 60s；`context.signal` 贯穿（宿主模型选择器 15s 超时预算内完成）。

### D7. 并发与清理

发现最多一个实例（in-flight promise 合并）；`registerProvider` 重注册只在新指纹时发生；`session_shutdown` 清定时器与 in-flight（abort）。不写任何磁盘缓存。

## 与 ../opencode-litellm-provider 行为基线的差异清单

| 差异 | 理由 |
|---|---|
| 接入方式：`/connect` 表单 → `/login`（宿主原生 api-key 登录）+ `$LITELLM_API_KEY` + `litellm.json` 配置文件（全局/项目级） | pi 无集成表单、工厂拿不到 options；参考 `fgrehm/pi-ollama-cloud` 的同类机制：Key 走宿主认证链，可配置项走双层配置文件（用户已拍板） |
| 发现触发：宿主 transform + 插件自建轮询 → 宿主两阶段 `refreshModels` + 扩展轮询调用 `modelRegistry.refresh({ providers: ["litellm"], force: true })` | pi 的刷新模型不同：restore/network 两阶段、结果经 `publish({persist})` 持久化到宿主 models store；轮询驱动宿主刷新而非自行重注册 |
| 发现已持久化（启用 `publish({ persist })`） | pi 原生目录机制（FileModelsStore）：跨会话回放 + `checkedAt` 新鲜度是宿主既有行为，pi-ollama-cloud 同款；LiteLLM 变更仍由轮询保持 5 分钟跟随 |
| 协议包 `@opencode/ai/providers/*` → pi-ai API id（`openai-completions` 等） | 宿主内置实现不同；映射已在 `map.ts` 固化并有测试 |
| Messages 调用地址：统一 `/v1` baseUrl → messages 模型逐模型 baseUrl 用根地址（不带 `/v1`） | `@anthropic-ai/sdk` 自带 `/v1/messages` 路径，provider 级统一 `/v1` 会拼出 `/v1/v1/messages`（D3，待实测复核） |
| variants（档位列表 + settings）→ `thinkingLevelMap`（pi 固定档位集） | pi 的档位模型：固定档位集 + `null` 隐藏，映射而非列表；OpenCode 侧 budget 档位的显式 token 数值（16000/64000）无法保留，档位可选用性保留、数值由宿主 `thinkingBudgets` 推导（D4） |
| 审计导出 / TUI 卡片 / 对话反馈 / `/litellm-audit-export` 不移植 | pi 侧 UI 能力（`ctx.ui`）形态不同，留后续变更（HANDOFF 明示可选） |
| 插件 `options`（pollInterval 等 4 项）→ `litellm.json` 配置文件字段（全局 + 项目级双层） | pi 工厂拿不到 options（HANDOFF 核实）；采用 pi-ollama-cloud 的配置文件模式，字段语义与上位仓库一致 |
| 401/403 通过返回 `[]` 撤下而非宿主事件 | pi 的 `refreshModels` throw 会保留旧模型（宿主 catch 语义），撤下必须走返回空清单 |

以下与基线**一致**（不再复述规则）：模型清单来源与过滤、保守合并、字段优先级与模态信任名单、models.dev 记录选择与家族表、推理档位生成规则（可用档位集合：budget 类生成 high/max 的判定条件不变）、阶梯截断与开关、协议判定顺序与覆盖、失败分类表、显示名与价格、凭据保密、空结果与异常数据。

## Risks / Trade-offs

- [pi 扩展 API 在 0.87.x 期间变化] → 宿主调用集中在 `src/extension/`；peer 声明 `"*"`（pi 官方扩展生态当前形态），CI 锁 0.87.1 实跑验证；升级宿主时重跑 tasks 4.x 验收。
- [扩展 provider 的 `/login` 流程实际表现未实测（源码推断 `composeApiKeyAuth` 自动生成）] → tasks 4.1 首项在真实 pi 中执行 `/login` 验证 Key 录入、auth.json 落盘与发现生效；不符则改用 `registerFlag` 或文档说明替代路径。
- [`refreshModels` 的 credential 解析时机与 env 插值顺序未在真实场景跑过] → tasks 4.1 验证 `$LITELLM_API_KEY` 在 `context.credential` 与请求头两条路径都出现同一把 Key。
- [Messages 模型 baseUrl 拼接（D3）错误] → 真实 Messages 部署验收（tasks 4.2）；错则只改 map.ts 一处。
- [budget_tokens 档位无法携带记录声明的预算数值] → 已核实为宿主 API 硬限制（ProviderModelConfig 无 per-model thinkingBudgets）；档位可选用性保留，数值由宿主推导；tasks 4.2 验收档位参数生效即可。
- [持久化清单中的模型 baseUrl 与后续地址变更不一致] → network 阶段每次用当前配置地址重新发现并覆盖持久化；restore 只是首次回放，最终一致。
- [轮询调用 `modelRegistry.refresh` 与用户手动刷新竞争] → 共享 in-flight 合并；宿主 refresh 自带 generation 检查（publish 被 superseded 时返回 false，源码核实）。
- [阶梯截断让用户无法使用超过阶梯点的长上下文] → 默认开启是上位仓库既定用户决策；可关闭。
- [models.dev id 与 LiteLLM 模型名不匹配] → 只是缺档位与补缺字段，不影响可用性（基线既定）。

## Migration Plan

1. 本地开发：`pi -e ./extensions/index.ts`（会话内 `/reload` 重载）。
2. 用户安装：`pi install git:github.com/rpchen/pi-litellm-provider`；写 `~/.pi/agent/litellm.json`（或项目 `.pi/litellm.json`、`LITELLM_BASE_URL`）提供地址；`/login` 选 LiteLLM 粘贴 Key（或设 `LITELLM_API_KEY`）。
3. 从手工 models.json 迁移：连接信息就位、模型可见后，删除 models.json 中的手工 litellm provider 块（扩展不代删）。
4. 回滚：`/logout` 移除 Key（如已录入）；`pi remove` 扩展；恢复手工 provider 块。扩展不写任何用户配置文件，无需清理。

## Open Questions

- LiteLLM 对 Anthropic Messages 的 `x-api-key` 头是否接受（`@anthropic-ai/sdk` 默认头）：tasks 4.2 真实验收；不通时 Claude 家族改走 Chat（LiteLLM 会协议转换），需与用户确认后改 spec。