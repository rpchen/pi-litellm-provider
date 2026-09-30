## Context

Pi 状态分布（已核对 0.87.1 源码）：

| 状态 | 位置 | 所有者 |
|---|---|---|
| endpoint 定义（canonical） | `~/.pi/agent/litellm.json`（严格 JSON，`JSON.parse` 读取） | 本插件 + 用户手改 |
| activation | `~/.pi/agent/litellm.activation.json` | 本插件 |
| 凭据 | `~/.pi/agent/auth.json`，key 为 provider id（`litellm` / `litellm-<id>`），值 `{type:"api_key",key}` | Pi 宿主（`/login`） |
| discovery snapshot/catalog | `~/.pi/agent/models-store.json`，key 为 provider id | Pi 宿主（`refreshModels` `publish`） |
| backoff / coordinator | 进程内存（`createProviderRefreshCoordinator`），不持久化 | 本插件 |

Pi 的 `ExtensionAPI` / `ModelRegistry` 门面**没有**凭据写入或 models-store 删除接口；`AuthStorage` 不在包 exports 中。

## Decisions

### D1 管理入口与交互
`/litellm-endpoints` 无参数：`ctx.ui.select` 主菜单（Add / 全部启用 / 全部停用 / 每个 endpoint 一行）→ 选中 endpoint 进入详情 `select`（Activate|Deactivate / Edit Base URL / Connect|Replace API Key / Disconnect / Delete / 返回）。输入用 `ctx.ui.input`，确认用 `ctx.ui.confirm`。TUI 与 RPC 模式都是宿主真实对话框。保留参数形式 `all` / `none` / `<id>`（PR9 兼容，不再需要 UI）。

差异：PR9 中在菜单里选中 endpoint 直接 toggle；现改为进入详情再 Activate/Deactivate（菜单项增多后直接 toggle 会误触 Delete 邻近操作）。activation 语义不变。

### D2 写 litellm.json：读-改-验-原子替换
不引入 JSONC 依赖：该文件本就由 `JSON.parse` 读取（带注释当前即解析失败）。流程：加锁（D3）→ 读原文 → `JSON.parse`（失败即拒绝，不写）→ 对**解析后的原对象**做最小变更（仅增/删/改目标 endpoint 的对应键，保持其它键与顺序）→ 校验 → 写同目录临时文件 → 替换前再读一次原文，与第一次不同则中止（冲突检测）→ `rename` 原子替换，失败则删除临时文件。缩进沿用原文件（检测不到用 2 空格）。

局限（记录在案）：`JSON.stringify` 会丢失重复键、并规范化数字字面量格式（值不变）；原本就不是合法 JSON（如含注释）的文件被拒绝而不是改写。

### D3 宿主文件锁协议
`auth.json` / `models-store.json` 由 Pi 用 `proper-lockfile`（`realpath:false`，锁目录 `<file>.lock`，`stale=30s`）串行化。插件不依赖 `proper-lockfile`（Pi 内部依赖，不是我们的 peer），而是实现同一协议：`mkdir <file>.lock` 成功即持锁；EEXIST 时检查 mtime 超过 30s 视为 stale 并回收；持锁期间每 10s 刷新 mtime；`rmdir` 释放；获取超时报错。写入用同目录临时文件 + `rename`，文件新建模式 `0600`。写前读到无法解析的内容则**拒绝**，不覆盖。宿主通过文件 revision（mtime/size）感知外部写入并重读。

### D4 凭据状态与宿主 `/login` 一致
Connected = `auth.json` 中存在该 provider id 的条目。default endpoint 另外识别 `LITELLM_API_KEY` 环境变量，显示为“已连接（环境变量）”，Disconnect 只删除 stored 凭据，不改环境变量。无法解析 auth.json 时显示“未知”，且写操作拒绝。API Key 输入规则：trim 后非空、不含空白/控制字符。Pi 扩展 API 没有掩码输入；输入时可见，保存后**任何位置都不回显**。

### D5 activation 与 Add / Delete 的交互
- Add：新 endpoint 必须默认 inactive。当前 activation 为 `all` 时，先把它物化为 `selected`（当前已激活且**已配置**的 id，排除新 id）再写配置；新 id 同时从任何残留 selected 列表中剔除，避免“幽灵激活”。先写 activation 后写配置：配置写失败时只留下无害的 activation 记录。
  - 取舍：此后手工在文件里新增的 endpoint 不会自动激活（`selected` 语义）。可接受，已写入 README。
- Delete（顺序：先清理、最后删定义，使中途失败可重试）：确认 → 取消激活并同步 provider（停止轮询）→ 从 `models-store.json` 删除该 provider 条目 → 删除 stored 凭据 → 从 activation 剔除 → 写配置移除 endpoint → 再同步并**二次**删除 models-store 条目（覆盖 in-flight refresh 的晚到 publish）→ 清理内存 diagnostics/coordinator。

### D6 legacy 单 endpoint 配置
legacy 下只在**添加第二个 endpoint**时迁移：确认后把有效的 `baseUrl`（文件或 `LITELLM_BASE_URL`）与 `protocolOverrides` 移入 `endpoints.default`，并删除顶层 legacy 字段（二者不能共存）；provider id、credential、snapshot 身份不变。legacy default 的地址若来自环境变量，则 Edit/Delete 拒绝（写文件也会被环境变量覆盖，属于不诚实的 UI）。legacy 且无地址时 default 视为不存在，不在列表中出现。

### D7 `default` 之外的 provider 凭据
沿用 PR9：非 default endpoint 只接受宿主存储的凭据，不读环境变量。

### D8 测试隔离
既有测试通过 `getAgentDir()` 读取真实 `~/.pi/agent`（基线 8 个失败）。加入 `bunfig.toml` preload，把 `PI_CODING_AGENT_DIR` 指向每次运行的临时目录；新增写路径的测试一律注入 `agentDir`。

## Differences vs baseline
| 差异 | 理由 |
|---|---|
| 主菜单选中 endpoint 进入详情而非直接 toggle | D1 |
| 通过 UI 新增后 activation 由 `all` 变为 `selected` | D5，满足“新建默认 inactive” |
| 新增 `endpoint-management` 能力；core 无变更 | 逻辑全部属于 Pi 宿主边界 |

## Risks
- 直接写 `auth.json` 依赖 Pi 的文件格式/锁协议（0.87.1 已核对）；真实 Pi E2E 固定版本保护该假设。
- 无掩码输入：Pi 扩展 API 限制；README 建议不想在屏幕上输入时使用宿主 `/login`（同一份凭据）。
