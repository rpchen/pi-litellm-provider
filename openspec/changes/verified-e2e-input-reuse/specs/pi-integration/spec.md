## MODIFIED Requirements

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

## ADDED Requirements

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
