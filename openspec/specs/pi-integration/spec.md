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
涉及 Pi 宿主契约的候选变更 SHALL 在 CI 中使用从 npm latest 解析的精确版本的真实 `@earendil-works/pi-coding-agent` 验证，而不是只依赖模拟 `ExtensionAPI`、直接调用 extension factory 或 package 文件存在性检查。E2E MUST 使用 Pi 自己的 `pi install` 安装固定 Git commit，MUST 隔离 `HOME`、XDG 与 `PI_CODING_AGENT_DIR`，MUST 使用本地 fake LiteLLM 与脱敏测试凭据，并 MUST 经过真实 extension loader、ModelRuntime、credential store、command registry 与 `refreshModels`。

该门禁 SHALL 支持 `E2E_SCOPE=full|delivery` 两种运行范围，未设置时 MUST 等价于 `full`。`full` MUST 保留本轮变更前的全部真实断言与真实请求分类；`delivery` SHALL 只验证当前候选的交付可用性。两种范围都 MUST 在 `E2E_TIMING_FILE` 写出机器可读报告，包含 `scope`、`group`、`status`、`hostInput` 与 `deliveryInputs`；报告写入失败 MUST NOT 掩盖真实 E2E 失败，也 MUST NOT 被当作存在证据。

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

#### Scenario: [E2E-SCOPE-FULL] 完整范围报告真实结论
- **WHEN** 以 `E2E_SCOPE=full`（或未设置该变量）运行真实宿主 E2E 并全部通过
- **THEN** 全部既有断言照旧执行，且 `E2E_TIMING_FILE` 报告 `scope: "full"`、`group: "pi"`、`status: "ok"` 与真实的 `hostInput` / `deliveryInputs`

#### Scenario: [E2E-SCOPE-DELIVERY] 交付范围只做真实交付验证
- **WHEN** 以 `E2E_SCOPE=delivery` 运行真实宿主 E2E
- **THEN** 脚本用 Pi 自己的 installer 安装固定 Git commit，从已安装包真实加载扩展并核对 command registry、provider/model 注册表身份与 provenance，然后发出恰好一次真实模型请求，不伪造完整矩阵的结论

#### Scenario: [E2E-SCOPE-INVALID] 未知范围不被默认接受
- **WHEN** `E2E_SCOPE` 取 `full`/`delivery` 之外的值
- **THEN** 脚本以非零退出码失败，而不是回退到某个默认范围继续跑

### Requirement: Pi explicit model capability mapping
Pi SHALL 提供宿主要求的id/name/api/input/cost/contextWindow/maxTokens并以Core明确reasoning verdict设置reasoning。支持无档位不得设false或省略map导致默认档位；unsupported为false；关键未知不得注册。

#### Scenario: [T29] 支持无档位
- **WHEN** 真实Pi接收supported与空variants
- **THEN** true且显式隐藏所有额外effort档位

#### Scenario: [T14] 不支持推理
- **WHEN** Core明确unsupported
- **THEN** false且不带推理请求设置

### Requirement: delivery 范围失败即门禁失败
`E2E_SCOPE=delivery` 的每一处真实失败（安装、加载、command 缺失、注册表身份或 provenance 不一致、真实模型请求失败或请求体/协议与注册表不符）MUST 让该次 CI job 失败。delivery 范围 MUST NOT 通过跳过、注释或放宽断言来"通过"；报告中的 `status` MUST 反映真实结论，失败时报告仍 MUST 记录 `status: "failed"` 供审计。

#### Scenario: [E2E-DELIVERY-FAIL] 真实交付失败不被吞掉
- **WHEN** delivery 运行中安装、加载、身份或真实模型请求任一步失败
- **THEN** 脚本以非零退出码失败，且写出的报告 `status` 为 `failed`，不会被记录成可通过的结论

### Requirement: 运行时输入证据覆盖真实交付依赖
E2E SHALL 记录可比较的运行时输入证据 `deliveryInputs`，其内容 MUST 来自实际安装产物而不是候选 checkout：实际安装克隆的 `package.json` 依赖字段、实际安装克隆的不可变 SHA、以及宿主 loader 是否真的为两个 peer 提供 alias。证据 MUST 满足：无直接/可选运行时依赖；`peerDependencies` 恰好是本仓库允许的 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` 且由宿主解析（`*`）；安装克隆中没有被打包的宿主 peer 副本；devDependencies 未被安装（MUST NOT 声称 dev 锁约束运行时）。

任何不支持、缺失或无法核实的部分 MUST 记为 `complete: false` 并带原因，MUST NOT 记为可复用证据。用于跨运行比较的对象 MUST 把候选自身的 SHA/版本字段归一化出去，因为候选等价性由独立的候选树比较判定。

#### Scenario: [E2E-INPUTS-HOST-PEERS] 只有宿主 peer
- **WHEN** 实际安装克隆声明了与允许集合一致的 peer 依赖且没有直接运行时依赖、也没有打包宿主副本
- **THEN** `deliveryInputs.complete` 为 `true`，并记录实际 manifest 字段与安装克隆 SHA 的归一化结果

#### Scenario: [E2E-INPUTS-EXTRA-DEP] 额外运行时依赖被拒绝
- **WHEN** 实际安装克隆出现非空 `dependencies` 或 `optionalDependencies`，或出现不在允许集合内的 peer
- **THEN** `deliveryInputs.complete` 为 `false` 并给出原因，而不是按"看起来也能跑"接受

#### Scenario: [E2E-INPUTS-NO-ALIAS] 宿主 alias 无法证实
- **WHEN** 无法从实际安装的宿主确认两个 peer 的 loader alias，或安装克隆 SHA 与候选不匹配
- **THEN** `deliveryInputs.complete` 为 `false`，该轮证据不得用于复用
