## Context

当前 diagnostics 经 `src/extension/diagnostics.ts:runtimeBuildInfo()` 分别读取 `package.json` 与 `dist/core-provenance.json`，无 audit 导出（`2026-09-26` 明确 scope-out），启动无日志。`dist/` 为已提交的交付产物，经 `scripts/verify-dist.ts` 按 provenance SHA 重建并 `git diff --no-index` 比对。不能把 Pi Git commit 写进 committed dist（commit 会因该修改本身变化，形成自引用），因此选择 Artifact Digest 而非 Plugin Commit。

## Decisions

### D1 Canonical 对象：`src/extension/runtime-identity.ts`
新增唯一 `RuntimeIdentity { pluginVersion, artifactDigest, coreCommit }` 与 `getRuntimeIdentity()`。diagnostics、audit、startup log 只读该对象，不各自拼装。运行时文件位置按现有 provenance 模式解析：`dist/runtime-identity.json`（编译后）回退 `../../dist/runtime-identity.json`（源码/测试）。格式非法时抛出 `RuntimeIdentityError`；diagnostics 降级显示 `unknown` 但正式 verification 必失败（D6），不静默伪造有效值。

### D2 三字段来源
- `pluginVersion`：构建时读取构建根 `package.json:version`，写入 identity；运行时只读 identity 文件。verification 断言 `identity.pluginVersion === package.json:version` 且非空。
- `coreCommit`：复用当次构建的 core selection SHA（与 `core-provenance.json:sha` 同一变量），写入 identity；verification 断言 `identity.coreCommit === provenance.sha` 且为完整 40 位小写 hex。不新增 Core SHA 来源，不运行时执行 Git。
- `artifactDigest`：构建时对输出 `dist/` 计算确定性 SHA-256，存储为 `sha256:<64 hex>`。与 OpenCode 插件算法逐字节一致（D3）。

### D3 Digest canonical 输入与自引用避免（与 OpenCode 一致）
输入范围：输出 `dist/` 下全部常规文件，递归，相对路径按 POSIX `/` 分隔并按 UTF-8 字节序排序；每个文件取原始字节 SHA-256 hex；manifest 为逐行 `<file-hex>  <relative-path>\n` 的 UTF-8 拼接；`artifactDigest = SHA-256(manifest)`。**排除 `runtime-identity.json` 自身**；包含 `core-provenance.json`、LICENSE 与全部 JS/d.ts。显式不纳入：绝对路径、构建时间、机器路径、用户名、checkout 目录、Git 状态、`.git`。`extensions/index.ts` 为稳定的薄转发入口，不纳入 digest（由 package test 断言其存在与转发语义），保持两插件 digest 输入范围对称（均为 `dist/`）。

### D4 Diagnostics
`formatProviderDiagnostics()` 保留现有 `Core: branch@sha` 行，追加 `Runtime Identity` 块：`Plugin Version <ver>`、`Artifact <digest前8>`、`Core Commit <sha前8>`。未知时显示 `unknown`，不泄露凭据/URL/原始错误。纵向链路：fixture → discovery → adapter state → command → `ctx.ui.notify` 保持不变，只追加行。

### D5 Audit export（新增，与 OpenCode 语义对齐）
新增 `src/extension/audit.ts`（`createAuditReport(endpoints, now)`）与 `src/extension/audit-file.ts`（`auditDirectory(agentDir)` + `writeAuditFile(report, dir)`）：
- 报告 `{ schemaVersion: 1, scope: "plugin-submitted", exportedAt, runtimeIdentity: {完整三字段}, endpoints: [{ id, providerId, status, modelCount, models }] }`；`models` 为 allowlist 构造的 Pi provider 模型记录（`id/name/api/reasoning/thinkingLevelMap/input/cost/contextWindow/maxTokens`），**排除 `baseUrl`**（含 LiteLLM 地址）与一切凭据/原始响应/可扩展设置。
- 为让 audit 能列出模型，`ProviderDiagnosticSnapshot` 增加可选 `models?: ProviderModelConfigLike[]`（refresh 成功路径写入，不改变现有状态语义；凭据缺失/auth/config 错误路径清空）。
- 命令 `/litellm-audit-export [endpoint-id]`：无参数导出全部 active endpoint；有参数时未知 id 报 warning、inactive 仍可导出其快照（标注 inactive）。写入 `<agentDir>/litellm-audit/litellm-audit-<ISO>-<16hex>.json`（目录 0700、文件 0600、原子写），经 `ctx.ui.notify` 报告绝对路径；失败不影响 provider 注册与轮询。
- audit 与 diagnostics 读取同一 `getRuntimeIdentity()`。

### D6 正式验证失败语义
`verify-dist` 在现有“重建 + git diff 零差异”之外增加：identity 文件存在且为合法 JSON；三字段存在且格式合法（version 非空且与 `package.json` 一致；digest 为 `sha256:<64hex>` 且与按 D3 重算值一致；core 为 40 位 hex 且与 provenance 一致）；provenance 缺失/来源不符/损坏同样失败。任一失败即抛错，不 fallback、不自动修复。

### D7 可重复构建与 package
同一 source + 同一 Core SHA + 同一 package version 的两次构建 digest 必须相同。`test:package` 要求 tarball 包含 `dist/runtime-identity.json` 与 `extensions` 入口；隔离安装后仍可读取；不依赖 `.git`/源码/build workspace；provenance 与 identity 的 coreCommit 一致；`extensions/index.ts` 仍转发到 committed JS。

### D8 真实宿主 E2E
沿用固定 `Real Pi 0.87.1 E2E`（`scripts/e2e-real-pi.mjs`，`E2E_PACKAGE_SPEC` 指向不可变 commit/tag）：真实 `pi install` 后验证 diagnostics 短值与 candidate 对应、audit 含完整值且模型 allowlist 无 baseUrl 泄露、startup 含同一 identity、不依赖 `.git`、隔离 HOME/XDG/`PI_CODING_AGENT_DIR`、不读用户真实配置。

### D9 启动日志
扩展 factory 与 `session_start` 路径经注入的 logger（默认 `console`）记录一行 `LiteLLM Runtime Identity plugin=<ver> artifact=<short> core=<short>`。只记录一次初始同步（避免每次重连刷屏），不打印凭据、绝对路径，不访问网络/Git。

## Differences vs baseline
| 差异 | 理由 |
|---|---|
| 新增 `runtime-identity.ts` canonical 对象，`runtimeBuildInfo()` 委托其实现 | D1：消除分别拼装 |
| 新增构建时 `dist/runtime-identity.json` 与 digest 计算 | D2/D3：artifact 不可变身份 |
| 新增 `/litellm-audit-export`（此前 scope-out） | D5：audit 必须承载完整 identity，与 OpenCode 对齐 |
| diagnostics 追加短形式 identity 块 | D4 |
| `ProviderDiagnosticSnapshot` 增加可选 `models` | D5：audit 需要已注册模型清单，不另建状态源 |
| verify/package 增加 identity ↔ bytes ↔ provenance 断言 | D6/D7 |
| E2E 增加 identity + audit 断言 | D8 |
| 启动加一行日志 | D9 |

## Risks
- 新增 audit 命令是用户可见新命令：README 必须同步；E2E 必须覆盖命令注册与隔离语义。
- diagnostics 快照扩展 `models` 可能增大内存：只保留已映射的 provider 模型（与注册一致），不存原始响应。
- audit 文件写入 agentDir：在 E2E 隔离目录中验证，不碰用户真实 agentDir。
