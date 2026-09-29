# pi-integration Specification

## Purpose
定义扩展在 pi 宿主中的注册形态与加载方式：扩展工厂调用 `pi.registerProvider` 注册 LiteLLM provider，`ProviderModelConfig` 的字段映射满足 pi 的要求，本地 `pi -e` 与远程 `pi install` 两种加载方式都能工作。

## Requirements

### Requirement: 扩展工厂注册 provider
扩展 SHALL 在扩展工厂函数中调用 `pi.registerProvider("litellm", config)` 注册 id 为 `litellm`、显示名为 `LiteLLM` 的 provider，使其参与启动时的模型选择与 `pi --list-models`；注册的 provider 配置 SHALL 包含规范化的 baseUrl、经宿主解析的 apiKey 引用（`$ENV_VAR` 形式）、逐模型的 `api` id 与 `refreshModels`。扩展入口 SHALL 解析到已提交的 `dist` 适配层产物；未连接（缺地址或 Key）时扩展 SHALL 仍完成加载，注册带空模型清单的 provider 或不注册 provider 中的哪种形态由 design 决定，两种形态都 MUST NOT 抛出加载错误。

#### Scenario: 启动时已连接
- **WHEN** 用户设置好连接信息后运行 `pi --list-models litellm`
- **THEN** LiteLLM provider 下列出当前 Key 可见的对话模型，且加载路径来自包内 `dist` 产物

#### Scenario: 未连接时加载
- **WHEN** 没有任何连接信息时启动 pi
- **THEN** 扩展从已提交产物正常加载，不出现加载错误，LiteLLM 下没有可用模型

### Requirement: 模型配置满足 pi 的字段要求
注册的每个模型 SHALL 提供 pi `ProviderModelConfig` 要求的字段：`id`、`name`、按协议的 `api` id、`reasoning`、`input`（text/image）、`cost`（input/output/cacheRead/cacheWrite）、`contextWindow`、`maxTokens`，以及有推理档位时的 `thinkingLevelMap`。字段值 SHALL 与 model-discovery 能力的判定结果一致。

#### Scenario: 完整字段
- **WHEN** 发现得到一个带推理档位的 Responses 模型
- **THEN** 注册配置包含 api `openai-responses`、非空 thinkingLevelMap、与发现结果一致的 cost 与 contextWindow

#### Scenario: 无推理档位的模型
- **WHEN** 发现得到一个没有 reasoning_options 的模型
- **THEN** 注册配置的 reasoning 为 false 且不带 thinkingLevelMap

### Requirement: 本地与远程安装都能加载
扩展 SHALL 在本地开发加载（`pi -e ./extensions/index.ts`）与远程安装（`pi install git:github.com/rpchen/pi-litellm-provider`）两种方式下完成注册；发布清单 MUST 包含 `extensions` 入口和 `dist` 编译产物，即使安装时禁用 lifecycle scripts 也能加载。运行时代码 MUST 只依赖 peer 依赖 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent`（由宿主环境提供），MUST NOT 依赖安装机器上不存在的文件路径（如平级仓库或构建缓存）。

#### Scenario: 本地加载
- **WHEN** 在仓库内运行 `pi -e ./extensions/index.ts --list-models litellm`
- **THEN** 扩展通过已构建的 `dist` 适配层注册，LiteLLM 模型按连接信息注册

#### Scenario: 远程安装加载
- **WHEN** 在任意目录执行 `pi install git:github.com/rpchen/pi-litellm-provider`，且安装生命周期脚本被禁用
- **THEN** 扩展从包内 `dist` 加载并完成注册，不因缺失平级仓库、缓存或现场构建工具而失败

### Requirement: 不干扰用户自有 models.json 配置
扩展 MUST NOT 读写用户的 `~/.pi/agent/models.json`；用户通过 models.json 自定义的同名 provider 块的行为（覆盖或共存）遵循 pi 宿主的组合规则，扩展不主动干预。

#### Scenario: 用户同时有手工配置
- **WHEN** 用户的 models.json 中存在手工配置的 `litellm` provider 块
- **THEN** 扩展不改写该文件，最终模型清单按 pi 宿主的 provider 组合规则呈现

### Requirement: 真实 Pi 宿主契约必须有永久 E2E 门禁
涉及 Pi 宿主契约的候选变更 SHALL 在 CI 中使用真实 `@earendil-works/pi-coding-agent@0.87.1` 验证，而不是只依赖模拟 `ExtensionAPI`、直接调用 extension factory 或 package 文件存在性检查。E2E MUST 使用 Pi 自己的 `pi install` 安装固定 Git commit，MUST 隔离 `HOME`、XDG 与 `PI_CODING_AGENT_DIR`，MUST 使用本地 fake LiteLLM 与脱敏测试凭据，并 MUST 经过真实 extension loader、ModelRuntime、credential store、command registry 与 `refreshModels`。

#### Scenario: 固定 Git 候选由真实 Pi 加载
- **WHEN** CI 用 Pi 自己的 package installer 安装当前不可变 Git commit 并启动 RPC 宿主
- **THEN** `litellm-endpoints` 与 `litellm-diagnostics` 作为 package extension command 出现在真实宿主 command registry，且扩展无加载错误

#### Scenario: 多 endpoint 在真实宿主中保持凭据与模型隔离
- **WHEN** 两个本地 fake LiteLLM endpoint 分别配置独立的宿主 credential 后执行真实 endpoint refresh
- **THEN** `litellm` 与 `litellm-company` 分别出现各自模型，每个 fake endpoint 只收到自己的 Bearer credential，且不会跨 endpoint 泄漏

#### Scenario: 非 operational 模型不会进入真实宿主
- **WHEN** fake LiteLLM 同时返回正常模型和 context/output 非正数的模型
- **THEN** 真实 Pi 只暴露 `contextWindow > 0` 且 `maxTokens > 0` 的 LiteLLM 模型

#### Scenario: activation 立即改变真实宿主可见模型
- **WHEN** 通过真实 Pi command 依次执行全部启用、全部停用和只启用 default
- **THEN** `get_available_models` 的 LiteLLM provider/model 集合立即对应变化，并持久化选择后的 activation 状态

