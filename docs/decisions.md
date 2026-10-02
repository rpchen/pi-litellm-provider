# 方案决策记录

记录 pi 宿主适配器的结构决策与背景（2026-09-26），供后续维护时参考，避免重新讨论。落地规格以 `openspec/specs/` 为准。

## 已确认的决策

| 主题 | 决策 | 背景 / 理由 |
|---|---|---|
| 仓库结构 | **新建独立仓库 `pi-litellm-provider`**，不把 pi 适配器并入 `opencode-litellm-provider`，也不给现仓库改名 | OpenCode 走 Git package（`ignoreScripts: true`，必须提交 `dist/`）、pi 走 `pi install git:`（会装 dependencies 且 peer 仅认 `@earendil-works/*`）；一个 package 无法同时干净地满足两个 host 的 manifest 与发行方式 |
| core 复用方式 | 宿主无关 core（LiteLLM 归一化、models.dev 补缺、能力映射、协议判定）由独立 `litellm-discovery-core` 单副本提供；Pi 构建时固定 SHA 并编译进 `dist`，不使用 git submodule、不提交源码副本 | Pi/OpenCode 安装目录没有平级仓库；构建期固定 SHA 同时满足单一来源、可复验和运行时无远端依赖 |
| 宿主边界 | 只替换宿主相关映射：构建缓存中的 `core/protocol.ts` 输出 `chat / responses / messages`，Pi 侧改为 pi-ai 内置 API 实现；Pi 侧使用 pi 的 provider 注册与凭据机制 | 协议判定规则本身与宿主无关，pi-ai 同样按 `Model.api` 逐模型选择实现 |
| 流式实现 | 委托 pi-ai 内置 API 实现，不自研 `streamSimple` | pi 官方指引：能用内置实现就不要照抄流式实现 |
| 发行渠道 | 不发布 npm；公开 GitHub 仓库，`pi install git:github.com/rpchen/pi-litellm-provider` | 与现仓库策略一致（现仓库明确不上 npm） |
| 验证凭据 | 真实 LiteLLM 验证统一使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 的 `LITELLM_BASE_URL` / `LITELLM_API_KEY`，只在运行时读取、只在内存使用 | 与现仓库约定一致；不得读取 `~/.config/opencode` 下用户自己的 Key，也不得把地址与 Key 写入仓库、fixtures、日志 |
| 仓库治理 | 公开仓库；功能分支 + PR + required `CI`；conventional commits；OpenSpec 管理规格变更 | 与现仓库治理方式保持一致 |
| core 共享落地（PR2） | 更新构建先解析 `litellm-discovery-core/main` SHA，按 SHA 缓存源码并生成忽略的临时 `src/core/`，再把同一输入编译进已提交 `dist`；产物写入 `core-provenance.json`，运行时不下载 core | Pi 以 git 仓库根为 package root，用户机器没有平级仓库；提交产物解决 `ignore-scripts` 安装，SHA 记录解决复验与来源追溯 |
| 凭据机制（2026-09-26 拍板） | Key 走 pi 宿主原生 `/login`（auth.json 持久）+ `$LITELLM_API_KEY` 兜底；地址走 `litellm.json` 配置文件（全局 + 项目级）+ `LITELLM_BASE_URL` 覆盖 | 参考 `fgrehm/pi-ollama-cloud` 的同类机制；宿主解析链保证发现与调用同一把 Key；不伪造 OAuth 语义 |

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

## PR2 构建与复验

- 更新构建：`bun run build:dist` 读取当时 `litellm-discovery-core/main` 的实际 SHA，获取到 `.tmp/discovery-core/<sha>/`，用同一份生成缓存完成编译，并提交 `dist/` 与 `dist/core-provenance.json`。
- 固定 SHA 复验：设置 `LITELLM_CORE_SHA=<40位SHA>`，或使用 `bun scripts/prepare-core.ts --from-provenance`，不会因为 core `main` 后续更新而改变既有产物的输入。
- 提交产物验收：`bun run verify:dist` 读取已提交 provenance 的 SHA，在临时目录重建并用 `git diff --no-index --exit-code` 与 `dist/` 比较；CI 不再用最新 `main` 覆盖后只检查“能否编译”。
- 缓存完整性：复制 core 前检查 checkout 的 `git status --porcelain --untracked-files=all`；发现未暂存、已暂存或未跟踪修改即失败，避免 provenance SHA 与实际源码不一致。
- `bun run typecheck` 与 `bun test` 会复用当前已准备的 SHA；首次运行时才解析 `main`。运行时入口 `extensions/index.ts` 只转发到 `dist/extension/index.js`，不访问 GitHub、平级仓库或本机缓存。
- PR2 只迁移 Pi；OpenCode 的适配层留在 PR3，跨仓库联动验证留在 PR4。

## Discovery quality 与宿主发布边界（2026-09-29）

- 插件的核心目标是让 Pi 正确使用模型能力，不承担计费职责。protocol、context/output、modalities、tools、reasoning/thinking 的正确性优先于价格完整性。
- models.dev provider 选择由共享 Core 统一维护：canonical 原厂 → OpenRouter → OpenCode → 全局唯一记录；Pi 不复制这套算法，也不靠新增硬编码模型家族修复新模型。
- OpenRouter/OpenCode 若仅作为能力 fallback，其价格不得冒充 LiteLLM deployment price；LiteLLM 显式价格优先。
- Core 可以保留缺少 limit 的 neutral model 用于 diagnostics，但 Pi 不得把 `contextWindow <= 0` 或 `maxTokens <= 0` 的模型注册给宿主。
- 任何这类边界修改必须有 Core 测试和 Core → Pi 纵向映射测试。

## Release 与会话收尾（2026-09-29）

- 用户可见 feat/fix 完成后检查 tag/Release 是否落后于 main。Release PR 同步 manifest/lockfile 版本与 README 当前 tag 示例；同一 main commit 完整 CI 通过后才能创建不可移动 tag。
- 发布后核对 tag SHA、Release、附件/checksum；清理一次性 workflow/branch。
- OpenSpec change 只有在 tasks 与证据一致、通过 CLI archive、canonical specs 已同步并再次 strict validation 后才算 Closed。
- 下一会话开始前重新读取三个仓库的 main、未合并 PR、最新 tag/Release、README 当前固定版本、dist provenance、active OpenSpec 和共享 testing-standard，不能只依赖聊天记忆。
- 会话结束前必须做 retrospective：把具体模型/UI 症状提升成通用不变量；检查“规范已写但实现只覆盖特例”、版本/README/tag 漂移、临时自动化残留，并把长期经验写入权威文档。


## 开发代码索引（2026-10-02）

已显式选择索引并入库；结构查询优先使用图谱与 coverage。Release 使用固定 0.11.0/full 从不可变 tag SHA 生成附件并回读验证；用户确认客户端下次启动同步发布快照，工作图谱另按当前源码刷新。新仓库不自动索引，不改变插件运行时依赖、discovery 语义、dist/provenance 或发行授权。详细流程见 docs/codebase-memory.md。

## Claude Code OpenSpec 入口（2026-10-02）

按用户要求使用 OpenSpec CLI 1.13.2 初始化 `.claude/skills/`，提供 propose、explore、apply、update、sync、archive 六个工作流。Claude Code 的项目 skill 发现路径是 `.claude/skills/`；不依赖它识别 `.agents/skills/`。原有共享入口保留，撤销只允许共享入口的旧规则；两处由 CLI 模板生成，升级时一起审阅，禁止手工分别维护。`CLAUDE.md` 导入 `AGENTS.md`。仅增加开发工具入口，不改变产品规格或运行时行为。
