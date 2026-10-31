# Real Pi E2E 的验证范围与输入证据

本文件说明 required check `Real Pi latest E2E` 的两种验证范围、报告字段、复用门槛和失败语义。产品行为与宿主契约仍以 `openspec/specs/` 为准；本文件只描述 CI 门禁本身。

## 两种验证范围

| `E2E_SCOPE` | 做什么 | 是否可产生可复用基线 |
|---|---|---|
| `full`（未设置时的默认值） | 变更前的全部真实断言：安装/加载、command registry、provider/model 注册表、operational limits、diagnostics 与 Runtime Identity、audit 导出、冻结 16 模型矩阵与真实协议请求、blocked 集合、metadata priority、LKG/outage、通知与 acknowledgement 重启、endpoint 管理全链路、legacy 迁移 | 是（仅当本轮实际成功） |
| `delivery` | 用 Pi 自己的 installer 安装固定 Git commit → 从已安装包真实加载扩展 → 核实 command registry 与 provider/model 注册表身份 → 核对运行中产物与已安装 provenance → 发出**恰好一次**真实模型请求 → 核实该回合的最终 assistant 消息不是 `error`/`aborted` | 否 |

`E2E_SCOPE` 取其他值直接失败，不会回退到某个默认范围。

```bash
# 本地完整矩阵（与 CI 相同，必须给精确宿主版本与不可变 Git 规格）
E2E_PI_VERSION=1.4.0 \
E2E_PACKAGE_SPEC=git:github.com/rpchen/pi-litellm-provider@<40-hex> \
npm run test:e2e:pi

# 只做交付验证
E2E_SCOPE=delivery … npm run test:e2e:pi

# 无宿主、无网络的输入证据自检（CI 也跑这一步）
npm run test:e2e:pi:inputs
```

## 报告

两种范围都在 `E2E_TIMING_FILE` 指向的路径写出 JSON（临时 HOME 清理前写入）。写入失败只是"没有证据"，不会也不允许掩盖真实 E2E 结论；失败时仍写 `status: "failed"`。

字段：

- `scope`：`full` | `delivery`。
- `group`：Pi 侧固定 `pi`。
- `status`：`ok` | `failed`。
- `hostInput`：**本轮 runner 的实际环境**，字段与共享 `e2e-host.mjs` 的 `environmentRecord` 一致（`hostPackage` / `hostVersion` / `candidateSha` / `node` / `npm` / `os` / `runner.ImageOS` / `runner.ImageVersion`）。直接调用随仓库交付的共享助手。绝不从解析器写下的 `host-input.json` 复制。
- `deliveryInputs`：运行时输入证据，见下。`complete` 不可能是"部分为真"。

## `deliveryInputs` 取证依据

证据来自**实际安装克隆**（Pi 1.4.0 的 `pi install git:` 会 `git clone` 到 `<agent dir>/git/<host>/<owner>/<repo>` 后 `git checkout <ref>`，再 `npm install --omit=dev --legacy-peer-deps`），不是候选 checkout：

- 实际 manifest 的 `dependencies` / `optionalDependencies` 必须为空（本仓库没有运行时依赖）。
- `peerDependencies` 必须恰好是 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent`，且值为 `*`（由宿主解析）；不接受 `peerDependenciesMeta`。
- 安装克隆内不得出现宿主 peer 的副本（`node_modules/@earendil-works/*`），否则就是绕过了宿主 alias。
- 宿主 loader 必须真的 alias 两个 peer：读取**已安装宿主**的 `dist/core/extensions/loader.js`，确认 `getAliases()` 为两者提供条目。无法定位宿主或不含 alias 时判 `complete: false`。
- 实际安装克隆的 `git rev-parse HEAD` 必须是完整 40 位 commit，且与 `E2E_PACKAGE_SPEC` 的 commit 一致；tag/分支等可变规格无法核实，判 `complete: false`。
- `devDependencies` 出现在安装克隆里同样判 `complete: false`：`dev` 锁只约束开发/CI，不约束、也不证明用户运行时。
- 共享助手提供 `hostExecutableDigest(command)` 时，把被实际执行的宿主二进制摘要并入 `deliveryInputs`（有界的"执行了哪个宿主"证据，不是通用指纹平台）；缺失或读不到执行文件则证据不完整，回退完整矩阵。

用于跨运行比较的对象把候选自身的 SHA 归一化为固定标记，因为候选等价性由候选/harness 的 Git 树比较单独判定；manifest 里同样不记录 `version`（version-only 变更属于允许复用的候选差异）。

任何一项不支持或无法核实都只落到 `complete: false` + 原因，绝不"看起来能跑就接受"。

## 复用门槛（由验证计划判定）

只有本轮 `deliveryInputs.complete === true`、候选与 harness 的真实 Git 内容、精确宿主版本与锁、Node/npm、runner 镜像与约定配置全部与此前一次**实际成功的完整矩阵**运行一致时，才跳过完整矩阵并引用那次运行。基线必须来自同仓库已完成成功的运行中真实的 full 结果，且 run attempt 必须是当前最新 attempt；缺失证据、证据不一致、基线缺失或只有 delivery/专项运行，一律完整跑。

required check 始终执行本轮 delivery 验证；汇总只显示本轮 scope、结论与被引用运行，不伪称本轮跑过完整矩阵。

## 失败语义

- delivery 的任一步真实失败（安装、加载、command、注册表身份、provenance 不一致、真实请求失败或请求体/协议不符）都会让 job 失败。
- Pi 的 prompt RPC 成功只代表 preflight 接受，`agent_end` 在响应流失败（`stopReason` 为 `error`/`aborted`）时同样发出，因此请求已发出不是成功证据；delivery 以 `agent_end` 中最后一个 assistant 消息的 `stopReason` 判定，`error`/`aborted` 一律判失败。
- 报告是附加证据，不改变退出码。
- `release.yml`（tag 触发的完整 E2E）不受影响；本门禁不做并行分组、不裁剪 Pi 矩阵，也不检查 Release 附件。

## 集成与验证状态

通用助手已作为本仓库自有脚本交付，不依赖平级仓库运行。宿主在私有prefix只解析/安装一次，随后直接用于探针与完整范围。`test:e2e-gate`覆盖宿主锁、Git双输入与GitHub完整基线回读；`test:e2e:pi:inputs`覆盖Pi依赖/peer/安装身份、scope与delivery回合判定（成功、`error`、`aborted`、缺消息负例）。实际Linux CI完整、复用和失败证据回填OpenSpec tasks，不把本地Windows/Node24运行等同CI。Pi tag工作流未修改。

## 真实Linux验收（2026-10-31）

完整基线[41179193705](https://github.com/rpchen/pi-litellm-provider/actions/runs/41179193705)：candidate05dd726、PR merge harness534bfed，完整报告kind=full/complete。同一临时PR追加版本元数据提交后的[41179482645](https://github.com/rpchen/pi-litellm-provider/actions/runs/41179482645)以candidate03c037b、mergeb85df2e实测delivery，引用原run/attempt，探针3.762秒、host job25秒、常规CI74秒，full步骤明确skipped且没有新full artifact。

该临时PR再注入仅delivery范围失败，[41179734333](https://github.com/rpchen/pi-litellm-provider/actions/runs/41179734333)的探针实际失败→必需Real Pi latest E2E失败，常规CI成功，未以旧绿色覆盖当前失败。临时PR65及其本次分支/worktree已关闭清理，故障代码不在本实现分支。tag Release差异为空。
