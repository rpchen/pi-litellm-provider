# Proposal

## Why

当前 required check `Real Pi latest E2E` 每个 PR / main 提交都执行完整真实矩阵，但它自身不记录本轮究竟验证了哪些输入：没有候选 SHA、harness SHA、精确宿主版本与锁、Node/npm 与 runner、运行时依赖契约的机器可读证据。结果是既无法在门禁汇总里说明"这次跑的就是当前交付物"，也无法在有实证依据时复用此前**实际成功**的完整矩阵，只能按 PR 标题、提交时间或人工记忆推测。缺证据时的默认行为必须是完整跑，而不是乐观复用。

## What Changes

- `scripts/e2e-real-pi.mjs` 增加 `E2E_SCOPE=full|delivery`（未设置时为 `full`）：
  - `full` 保留全部既有断言与真实请求分类，并在 `E2E_TIMING_FILE` 写出 `scope` / `group` / `status` / `hostInput` / `deliveryInputs`（报告在临时 HOME 清理前写入，写入失败不得掩盖真实 E2E 失败）。
  - `delivery` 只做真实交付验证：用 Pi 自己的 installer 安装固定 Git commit、真实加载扩展并从已安装包得到 command/registry 身份与 provenance，然后发出**一次真实模型请求**；真实交付失败必须让整个 job 失败。
  - 两个 scope 都收集运行时输入证据：实际安装克隆的 `package.json`、不可变安装克隆 SHA、无直接运行时依赖、仅有的两个宿主 peer 且由宿主 loader alias 提供。任何不支持或无法核实的证据记为 `complete: false` 并给出原因，绝不伪装成可复用基线。
- `.github/workflows/ci.yml` 的必需 job `Real Pi latest E2E`（名称不变）：一次性解析 latest 精确宿主版本并在私有 prefix 安装（PATH 与"实际被调用的二进制路径"校验），先跑 delivery 探测，再由验证计划决定是否运行完整矩阵（完整步骤名固定为 `Run full real Pi host E2E`），只有 full 运行才产生并上传可复用基线 `e2e-full-validation`；job 需要 `actions: read` 以读取此前真实运行的证据。常规 `CI` job 与 tag 触发的 `release.yml` 完整 E2E 保持不变。
- `package.json` 增加输入证据自检入口（纯 Node，无宿主、无网络）；`docs/e2e-ci.md` 记录 scope 语义、证据字段、复用门槛与失败语义。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pi-integration`: 真实 Pi 宿主 E2E 门禁新增 scope 分流、报告字段、delivery 交付验证与运行时输入证据要求。
- `release-governance`: required check `Real Pi latest E2E` 的语义新增"只允许引用实际成功的完整矩阵基线"，并明确 delivery 运行永远不是基线。

## Impact

- 受影响文件：`scripts/e2e-real-pi.mjs`、`.github/workflows/ci.yml`、`package.json`、新增 `docs/e2e-ci.md`、本 change 的 OpenSpec 产物。
- 不改变扩展运行时行为与宿主 API 使用面：仍为 `registerProvider` / `refreshModels` / `credential` / `/litellm-*` command，peer 依赖仍只有 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent`（声明为 `*`，由宿主 loader alias 解析），依赖区间随 CI 解析的 latest 精确版本（当前真实版本基线 1.4.0）。
- 与共享 core 的边界不变：Core 仍负责 LiteLLM 归一化、grouping、协议判定、models.dev 匹配、能力/limits/价格语义；本仓库只负责 Pi 宿主边界与 CI 门禁。
- 不新增运行时依赖，不改 ruleset 与 required check 名称，不删除任何既有 E2E 断言。
- 证据/基线格式依赖跨仓库共用的通用助手（`scripts/e2e-host.mjs`、`scripts/e2e-validation.mjs`），它们由主会话在本 change 完成后统一拷入；在此之前 workflow 中的相关步骤属于待集成状态，不得宣称分流已生效。
