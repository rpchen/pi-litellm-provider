# Design

## Context

见 `proposal.md` — Why。当前状态的实现事实（只读核查所得，作为设计约束）：

- `Real Pi latest E2E`（`.github/workflows/ci.yml` 的 `real-pi-host`）现在自己 `npm view` 一次 latest、`npm install --global`，然后 `npm run test:e2e:pi` 跑完整矩阵；脚本不写任何报告文件，也不记录宿主/runner/依赖证据。
- Pi 1.4.0 发布的宿主源码（工作区审计副本 `.tmp/ci-e2e-audit/pi-host-source/package/dist/core/`）证明两件事：`package-manager.js` 的 `installGit` 对 Git 包执行 `git clone` → `git checkout <ref>` → `npm install --omit=dev --legacy-peer-deps`（因此安装克隆保留 `.git`，可用 `git rev-parse HEAD` 核实实际 SHA，且 peer 依赖不会被装入 node_modules）；`extensions/loader.js` 的 `getAliases()` 把 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent` 显式 alias 到宿主自身实现。
- 本仓库 `package.json` 没有任何 `dependencies`，只有两个 `"*"` peer 依赖；`devDependencies` 仅供开发/CI，不进入用户运行时。
- 通用助手 `scripts/e2e-host.mjs`（宿主 resolve/install）与 `scripts/e2e-validation.mjs`（plan/record）由主会话在本 change 完成后统一拷入 Pi 仓库；本 change 只负责 Pi 侧脚本、workflow、文档并**显式保持集成待完成状态**。

## Goals / Non-Goals

**Goals:**

- 让 Pi E2E 每次运行都产出可比较的真实证据（`scope`/`group`/`status`/`hostInput`/`deliveryInputs`），使"是否可复用此前完整矩阵"成为可核实的判断而不是推测。
- `delivery` 范围用最短真实链路证明当前候选可交付：真实 `pi install` 固定 commit、真实加载与 command/registry 身份、真实 provenance、一次真实模型请求。
- `full` 范围零断言损失；分流与报告不得成为隐藏失败的途径。

**Non-Goals:**

- 不做 Pi 侧的并行分组矩阵或 reduce 矩阵（本 change 明确不涉及）。
- 不检查 tag/Release 附件；`release.yml` 与其完整 E2E 保持原样。
- 不改 ruleset、required check 名称、Bash 缓存策略，不引入新的运行时依赖。
- 不在本 change 内实现通用助手（`e2e-host.mjs` / `e2e-validation.mjs`）或对它们写测试。

## Decisions

**D1. scope 用环境变量 `E2E_SCOPE=full|delivery`，未设置等价 `full`，非法值直接失败。**
理由：既有 CI 调用与本地 `npm run test:e2e:pi` 不需要改命令即可保持完整矩阵；非法值失败而不是猜测，避免拼写错误把完整矩阵静默降级。备选（默认 delivery）被否，因为任何未声明场景都必须偏向更严格的验证。

**D2. 把现有完整矩阵整体搬进 `runFullScope()`，`delivery` 走独立的 `runDeliveryScope()`。**
理由：两者共享的只有隔离环境目录与常量；把 setup 抽成公共流程会改动 1300 行既有断言的上下文，风险大于重复约 40 行安装/配置代码。`runFullScope()` 的函数体缩进与原 `try` 块一致，diff 只有边界行，断言逐字不变。备选（共享 bootstrap 抽取）被否：任何抽取都要重排既有断言顺序。

**D3. `hostInput` 由本轮脚本自己观察本 runner（优先调用共享 `e2e-host.mjs` 的 `environmentRecord`），不复制解析器的 `host-input.json`。**
理由：解析器记录的是解析步骤看到的宿主/锁，报告要证明的是“真正执行这次 E2E 的 runner”。直接调用同一个 `environmentRecord` 保证字段 schema 一致（`hostPackage`/`hostVersion`/`candidateSha`/`node`/`npm`/`os`/`runner`），而不引入新的 hostInput 字段；助手未就位时按同一 schema 从运行时事实生成，字段不齐自然导致计划侧不匹配 → 完整跑。

**D4. 运行时输入证据只采信实际安装克隆，不采信候选 checkout。**
理由：候选 checkout 的 `package.json` 不能证明"装进去的东西"就是它，也不能证明安装后被 npm 改写/补装了什么。实现读取 `<agentDir>/git/<host>/<owner>/<repo>/package.json`（Pi 1.4.0 实际安装路径）并 `git rev-parse HEAD` 核实不可变 SHA。

**D5. `deliveryInputs` 的比较对象归一化掉候选自身 SHA/版本。**
理由：候选等价性由独立的候选/harness Git 树比较判定；把 SHA 放进逐字节相等的证据对象只会让每次提交都"证据不同"，从而把复用变成永不发生。实现把与候选一致的安装 SHA 归一化为固定标记，其他情况下保留原值（于是不同 → 不可复用，正确失败方向）。版本同理不计入依赖契约。

**D6. 证据不足一律 `complete: false` + 原因，而不是部分接受。**
理由：复用门槛的唯一安全默认是"证据完整才复用"。以下都判 false：非 `git:<host>/<owner>/<repo>@<ref>` 规格、安装克隆 SHA 非 40 位十六进制或与候选不符、出现任何 `dependencies`/`optionalDependencies`、peer 依赖不恰好是允许的两个或值不是 `*`、安装克隆内出现 `node_modules/@earendil-works`（被打包的宿主副本）、无法从实际宿主确认两个 peer 的 loader alias。

**D7. 报告写入放在 `finally`，永不抛出。**
理由：报告是附加证据，真实 E2E 结论优先；同时失败时仍写 `status: "failed"`，让"没有证据"与"证据为失败"都能被审计区分。

**D8. 工作流先跑 delivery，再按验证计划决定是否跑完整矩阵；完整步骤名固定 `Run full real Pi host E2E`。**
理由：交付探测是每个候选都必须通过的证据，先跑可让"候选根本装不上/加载不了"的失败尽早暴露；完整矩阵的名称固定，使验证计划与实际运行的 step 名可被逐字校验（不接受按名字模糊匹配）。

**D9. 宿主安装改为基础通用助手的一次性 resolve + 私有 prefix install，`PATH` 前置真实二进制并校验实际路径。**
理由：与 OpenCode 侧同一输入政策（同一轮只解析一次 latest，四组/多 job 同锁），且避免全局安装污染与"PATH 上恰好有别的 pi"造成的假通过。助手 CLI 用 `--host-package @earendil-works/pi-coding-agent --host-command pi`，Pi 侧另按宿主包规格构造 `git:github.com/<owner>/<repo>@<sha>`。

**D10. 证据自检以 `node scripts/e2e-real-pi.mjs --self-check` 形式内建，不新增测试文件。**
理由：本 change 的文件所有权只覆盖该脚本，纯函数自检（scope 解析、归一化、拒绝路径、hostInput schema）可在无宿主无网络下运行并作为负向证据；真实闭环仍由 CI 的真实 E2E 提供，不用自检冒充 E2E。

**D11. 宿主可执行文件摘要作为 `deliveryInputs` 内的可选有界证据。**
理由：共享助手导出 `hostExecutableDigest(command, env)` 时把“实际执行的宿主二进制”摘要并入 `deliveryInputs`，不新增 `hostInput` 字段、不扩建通用指纹平台；摘要缺失不影响依赖证据的完整性，助手未拷入时明确留作主会话跟进项。

**共享 core 差异（config 规则要求列表说明）**

| 差异 | 理由 |
|---|---|
| 无 | 本 change 不改动任何 discovery/Core 业务语义（归一化、grouping、协议判定、models.dev 匹配、能力/limits/价格、LKG）。Core→Pi 的 `ModelSpec` 映射与既有断言保持不变。 |

**网络与降级相关（config 规则要求）**：`delivery` 只依赖本地 fake LiteLLM 与宿主自身；不依赖 models.dev 或真实 LiteLLM。宿主 latest 解析失败属 workflow 层失败（不是"降级为完整跑"），因为此时无法确定被测宿主版本。LiteLLM/models.dev 不可达时的产品行为、缓存与刷新触发方式完全不变，仍由 Core 的既有语义决定。

**协议映射（config 规则要求）**：不涉及；delivery 的一次真实请求使用既有 `modelInfo(..., "chat")` 的 chat 协议模型，走 `openai-completions`，与既有完整矩阵同一映射路径。

## Risks / Trade-offs

- [Pi 发布版的安装路径或 loader alias 结构变化，导致证据无法核实] → 判 `complete: false` 并退化为完整矩阵运行（安全方向），并在 `docs/e2e-ci.md` 记录取证依据与升级方式。
- [delivery 只发一次请求，覆盖不到协议矩阵/凭据隔离/生命周期] → 明确由完整矩阵或基线引用负责；门禁汇总必须显示本轮 scope，禁止把 delivery 结论当完整验收。
- [报告与验证计划耦合（字段名/位置）] → 字段名按跨仓库约定的最小集合实现，`docs/e2e-ci.md` 与 change 规格同步记录；通用助手未落地前 workflow 步骤属待集成状态。
- [delivery 增加一轮宿主安装/加载时间] → 与省下的完整矩阵（约 90 秒量级）相比可接受；若实测 delivery 明显变慢，按真实数据再调整，不预先增加机制。
- [同一 job 内先 delivery 后 full，失败归因变复杂] → 步骤名固定且各自独立失败，汇总步骤在 `always()` 下输出 scope/结论。

## Migration Plan

1. 脚本先落地（含 `--self-check`）并通过本地自检；
2. workflow 改为 resolve → install → delivery → plan → 条件 full → record → upload，先与通用助手一同就位；助手未拷入前该 job 视为待集成，不得宣称分流生效；
3. 首次真实 CI 成功后才可能产生可复用基线；此前所有运行都是完整矩阵，行为等价于旧门禁；
4. 回滚：`E2E_SCOPE` 不设置即完整矩阵；必要时把 workflow 的 delivery/plan 步骤移除即回到单步完整运行，脚本本身不会改变既有断言。

## Open Questions

无。
