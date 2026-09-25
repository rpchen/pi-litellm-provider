# 方案决策记录

记录 pi 宿主适配器的结构决策与背景（2026-09-26），供后续维护时参考，避免重新讨论。落地规格以 `openspec/specs/` 为准。

## 已确认的决策

| 主题 | 决策 | 背景 / 理由 |
|---|---|---|
| 仓库结构 | **新建独立仓库 `pi-litellm-provider`**，不把 pi 适配器并入 `opencode-litellm-provider`，也不给现仓库改名 | OpenCode 走 Git package（`ignoreScripts: true`，必须提交 `dist/`）、pi 走 `pi install git:`（会装 dependencies 且 peer 仅认 `@earendil-works/*`）；一个 package 无法同时干净地满足两个 host 的 manifest 与发行方式 |
| core 复用方式 | 宿主无关 core（LiteLLM 归一化、models.dev 补缺、能力映射、协议判定、轮询与降级）按**单副本**共享，不用 git submodule、不复制两份 | 现仓库 `src/core/` + `src/net/fetch.ts` 约 850 行且测试已 host-free；submodule 在 pi/OpenCode 两侧安装路径都会引入额外摩擦 |
| 宿主边界 | 只替换宿主相关映射：`src/core/protocol.ts` 里 `chat / responses / messages` → `@opencode/ai/providers/*`，pi 侧改为 pi-ai 内置 API 实现；pi 侧使用 pi 的 provider 注册与凭据机制 | 协议判定规则本身与宿主无关，pi-ai 同样按 `Model.api` 逐模型选择实现 |
| 流式实现 | 委托 pi-ai 内置 API 实现，不自研 `streamSimple` | pi 官方指引：能用内置实现就不要照抄流式实现 |
| 发行渠道 | 不发布 npm；公开 GitHub 仓库，`pi install git:github.com/rpchen/pi-litellm-provider` | 与现仓库策略一致（现仓库明确不上 npm） |
| 验证凭据 | 真实 LiteLLM 验证统一使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 的 `LITELLM_BASE_URL` / `LITELLM_API_KEY`，只在运行时读取、只在内存使用 | 与现仓库约定一致；不得读取 `~/.config/opencode` 下用户的 Key，也不得把地址与 Key 写入仓库、fixtures、日志 |
| 仓库治理 | 公开仓库；功能分支 + PR + required `CI`；conventional commits；OpenSpec 管理规格变更 | 与现仓库治理方式保持一致 |

## 判断依据

结构选择经过一次 TypeSafe（Jev 1.13.0）结构化判断，输入为两仓库的真实结构、发行方式与 pi provider API 约束：

| 判据 | 结果 |
|---|---|
| 仓库结构 | `two_repos_with_shared_core_package` 0.57 > `two_repos_copy_core` 0.40 ≫ 合并方案 0.02 / 0.01 |
| 可逆性 | “先分开、以后再合”更易反悔 0.97 |
| core 可复用性 | 0.73 |
| 身份错配摩擦 | 0.83 |
| 同仓双 host 维护负担 | 0.81 |

架构项置信度仅 0.44：两条“分仓”路线接近打平，被明确否掉的是“合并进同一 package”。因此本仓库先落地 pi 适配器，core 抽取时机可晚于首次跑通。
