## Context

Pi 侧状态分布（沿用 2026-10-01 endpoint-management 的审计，仍准确）：

| 状态 | 位置 | 所有者 |
|---|---|---|
| endpoint 定义 | `~/.pi/agent/litellm.json`（严格 JSON） | 本插件 + 用户手改 |
| desired activation | `~/.pi/agent/litellm.activation.json` | 本插件 |
| credential | `~/.pi/agent/auth.json`，key=providerId | Pi 宿主（`/login`），本插件通过 lockfile 协议读写 |
| discovery snapshot | `~/.pi/agent/models-store.json`，key=providerId | Pi 宿主（`refreshModels.publish`） |
| 进程内 applied/失败 | 无独立 channel；只在每次 `refreshModels` 内即时判断 | **本变更新增** |

冻结的产品原则：

> 配置表达用户意图，runtime 表达现实；UI 必须诚实展示两者，而 `/models` 只承诺现实。

即：

- **desired state** 来自 activation 持久化（`litellm.activation.json`）。runtime 失败不回滚它。
- **validation state** 来自配置加载时的判断；与 runtime setup 共用 `normalizeLiteLLMURL`，确保 "manager 说合法但 runtime 拒绝" 或反过来不可能发生。
- **credential state** 是 `stored` / `environment`(default 专属) / `none` / `unknown`，不再被翻译为"已连接"。
- **applied state** 是进程内最近一次 runtime apply 的结果：`active`（provider 已注册且最近一次 refresh 成功）/ `not-applied`（尚未尝试或被反注册）/ `error:<kind>`（带分类：credential-missing、config-invalid、auth、network、parse、cancelled）。
- 最近一次 `discovery error`（网络/auth/parse/timeout）独立于 applied state 保留，供诊断解释。

## Decisions

### D1 Canonical `EndpointState` 模型（纯函数、可单测）

新建 `src/extension/endpoint-state.ts`，导出：

```ts
type DesiredState = "enabled" | "disabled"
type ValidationState = { kind: "ok" } | { kind: "invalid"; reason: string }
type CredentialState = "stored" | "environment" | "none" | "unknown"
type AppliedState =
  | { kind: "active"; lastDiscoveryAt?: string; modelCount: number }
  | { kind: "not-applied" }            // 尚未尝试 / 已被反注册
  | { kind: "error"; category: ApplyErrorCategory; message?: string; at?: string }

type ApplyErrorCategory =
  | "credential-missing"
  | "config-invalid"
  | "auth"
  | "network"
  | "parse"
  | "cancelled"

interface EndpointState {
  endpointId: string
  desired: DesiredState
  validation: ValidationState
  credential: CredentialState
  applied: AppliedState
}

type UserVisibleStatus =
  | "disabled"
  | "disabled-invalid"
  | "enabled-active"
  | "enabled-needs-authentication"
  | "enabled-not-applied"
  | "enabled-error"
  | "enabled-invalid-configuration"

function userVisibleStatus(state: EndpointState): UserVisibleStatus
```

派生规则（冻结）：

```
validation.kind = invalid                  → enabled-invalid-configuration | disabled-invalid
desired = disabled                          → disabled
credential ∈ {none, unknown}                → enabled-needs-authentication
applied.kind = active                       → enabled-active
applied.kind = not-applied                  → enabled-not-applied
applied.kind = error                        → enabled-error
```

UI 标签映射（Pi 中文文案，与 OpenCode 对齐）：

```
enabled-active                  → "已启用 · 已生效"
enabled-needs-authentication    → "已启用 · 需要认证"
enabled-not-applied             → "已启用 · 未生效"
enabled-error                   → "已启用 · 出错"
enabled-invalid-configuration   → "已启用 · 配置非法"
disabled                        → "未启用"
disabled-invalid                → "未启用 · 配置非法"
```

凭证状态映射（替换"已连接"）：

```
stored       → "已保存 API Key"
environment  → "API Key 来自环境变量"
none         → "未保存 API Key"
unknown      → "凭据状态未知"
```

### D2 `loadEndpointRegistry` 不再丢弃非法 endpoint

新增 `RawEndpointRegistry`：保留每个 endpoint 的原始 `baseUrl` 字段（无论合法与否），以及解析出的 `validation: ValidationState`。

- 之前：`{ baseUrl: "ht!tp://x" }` 被 loader warn 后**跳过**，管理中心看不到。
- 之后：endpoint 仍出现在 registry，但 `validation.kind = "invalid"` 且 `validation.reason` 描述具体错误；`ExtensionConfig.baseUrl` 用占位空串，runtime 看到 `validation.kind != "ok"` 直接拒绝 apply。
- `mutateConfig`（`config-store.ts`）的 `validateBaseUrl` 与 runtime 的 `normalizeLiteLLMURL` 共同作为唯一的 URL validation 入口；不接受新规则（不引入端口号、路径白名单等）。

### D3 `applied` 状态的写入时机

- `activateEndpoint(id)`：先 `applied[id] = { kind: "not-applied" }`，再注册 provider；调用 `modelRegistry.refresh({ force: true })` 等结果：
  - 成功 → `applied[id] = { kind: "active", lastDiscoveryAt, modelCount }`
  - 抛错或返回 empty 是因为 credential-missing / config-invalid → 对应 `error` 类别
- `deactivateEndpoint(id)`：`unregisterProvider` 之后 `applied[id] = { kind: "not-applied" }`（desired 已切到 disabled）。
- 周期性轮询的 refresh 失败 → 若 desired=enabled 且当前 applied=active，保留 active 但更新 diagnostics 的 lastError（不修改 `applied.kind`）；若 applied=error 且 refresh 仍失败，更新 `error.message/at`。
- 重启进程后 applied 一律从 `not-applied` 开始：恢复 snapshot 不算 applied（snapshot restore 只是恢复上次 discovery 结果，不代表本轮已注册）。

### D4 `/models` 严格语义（即 `refreshModels` 返回值）

`refreshProviderModels` 在返回模型清单前先查 `endpointStateFor(id)`：

- 只有 `desired=enabled ∧ validation.kind=ok ∧ credential∈{stored,environment}` 且当前调用本身是 authorized network refresh 或 compatible snapshot restore 时，才返回非空。
- desired=disabled / invalid / credential-missing / apply 失败 → 一律 `[]` 并让宿主清空模型。
- **stale snapshot 重放**：`restore` 路径（`allowNetwork=false`）同样遵守以上三道闸。即 endpoint 仍 enabled + validated + credential present，但之前一次 refresh 失败 → 仍可重放该 endpoint 自己的 endpoint-compatible snapshot（这本来就是 last-known-good 设计）；只是不得跨 endpoint 或者跨越 disable/invalid 边界重放。

这条规则把"`/models` 只承诺现实"落到唯一一处：provider 的 `refreshModels`。

### D5 Retry / Apply again 入口

`/litellm-endpoints → endpoint detail` 当 `userVisibleStatus ∈ {enabled-not-applied, enabled-error, enabled-needs-authentication}` 时新增选项：

- **Retry**（或等价 **重新应用**）：等价于对该 endpoint 调 `ctx.modelRegistry.refresh({ providers:[providerId], force: true })`，await 后用最新 applied 状态刷新 UI。

不做：后台自动重试、指数退避、网络恢复检测。现有轮询 loop 仍按 `pollInterval` 自然 reconcile。

### D6 Diagnostics 完整 detail

`/litellm-diagnostics <endpoint-id>` 对**任意** endpoint（含 disabled、invalid）输出至少：

```
Endpoint: <id>
Provider: <providerId>
状态: <UserVisibleStatus 中文标签>
期望状态: 已启用 / 未启用
配置: 合法 / 非法（<reason>）
凭据: 已保存 API Key / 未保存 API Key / API Key 来自环境变量 / 凭据状态未知
Runtime: 已生效（N 个模型）/ 未生效 / 出错（<category>）
最近错误: <message>(可省)
最近成功发现: <host 时区 + offset>(可省)
当前注册模型数: <N>
```

随后仍接现有 `formatProviderDiagnostics` 内容（Core diagnostics / publication / 缓存 / Runtime Identity 等）。

无参总览：每个 endpoint 一行，含 `✓/○` + id + providerId + 用户可见状态 + models=N。

### D7 管理中心列表行

`/litellm-endpoints` 主列表行格式：

```
✓ <id> · <用户可见状态> · <credential 标签>
○ <id> · <用户可见状态> · <credential 标签>
```

endpoint detail 顶部标题行同步使用同一标签组合，不再单独维护一套。

### D8 不侵入 Core

`EndpointState`、用户可见标签、credential 存在性、applied 状态全部在 adapter 层实现。Core 只继续提供 `isEndpointID` 与 `normalizeLiteLLMURL` 作 URL 判定唯一入口。本轮 core 仓库零改动。

### D9 与 OpenCode 侧语义对齐

`opencode-litellm-provider` 的 `improve-user-visible-state-consistency` change 提供相同的：

- 状态词汇表（英文内部 token 相同；中文用户文案一致）
- `/models` 严格语义（在 OpenCode 由 `snapshot.ready && snapshot.connection && snapshot.apiBaseURL` 派生等价条件）
- Retry 入口
- Diagnostics detail 字段

两侧只共享**语义**，不共享实现（避免把宿主状态机下沉到 core）。

## Differences vs baseline

| 差异 | 理由 |
|---|---|
| `loadEndpointRegistry` 返回 invalid endpoint | 支撑 Disabled·Invalid / Enabled·Invalid configuration；让非法配置始终可诊断 |
| `applied` 只在进程内 | 跨进程重启的状态不可靠；重启即 not-applied，等下一轮 refresh 校准，符合"runtime 表达现实" |
| credential "stored" 不再翻译成"已连接" | 冻结需求：credential exists ≠ connected |
| Add/Edit URL 校验不变 | 与既有 `validateBaseUrl` + `normalizeLiteLLMURL` 一致，避免 validation 双重标准 |

## Risks

- `applied` 在进程内，重启短暂窗口内 UI 显示 "已启用 · 未生效"：可接受，refresh 立即触发；README 会写明这是预期行为。
- `modelRegistry.refresh` 的失败不抛（Pi 会吞掉 host 侧异常）：通过 `setProviderDiagnostics` + 显式 `applied` 槽位兜底，不依赖宿主异常通道。
- 历史 `litellm.activation.json` 的 `mode:"all"` 保留兼容；新语义不修改其序列化格式。

## Migration

- 不需要用户手工迁移。
- 已有"非法 endpoint 被跳过"的用户：升级后这些 endpoint 重新出现在管理中心，标记为 `配置非法`；用户编辑 URL 修复后即可正常 enable。
- 已有 `models-store.json` 中由旧版本写入的 snapshot 仍受 endpointFingerprint 保护，仅在同 endpoint 同 credential 下重放；本轮不改变该指纹计算。
