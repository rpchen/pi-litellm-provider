# AGENTS.md

本文件是 AI 编码代理在本仓库工作时必须遵守的约定。变更流程由 openspec 管理（见 `openspec/config.yaml`）。

> 本仓库是独立 git 仓库（remote: `rpchen/pi-litellm-provider`），物理上嵌套在 LiteLLM 部署仓库目录下，
> 但两者历史互不相干：在本目录内执行的 git 命令只作用于本仓库。

## 目录结构

| 路径 | 用途 |
|---|---|
| `extensions/` | pi 包入口（`package.json` 的 `pi.extensions` 指向这里），默认导出扩展工厂 |
| `src/extension/` | pi 适配层：provider 注册、凭据、模型映射、命令 |
| `test/` | Bun 单元测试；`test/fixtures/` 放脱敏后的 LiteLLM / models.dev 响应样本 |
| `docs/` | 文档；`docs/decisions.md` 记录用户拍板的方案决策（实施前必读） |
| `openspec/` | 变更提案、能力规格、归档 |
| `.agents/skills/` | agent skills 唯一副本（入库，保证协作者可复现）：pi 会加载项目/仓库祖先的 `.agents/skills/`，其他 agents 工具也认这一位置；不再生成 `.pi/skills/` 副本 |

## 规则

1. **临时文件**放 `.tmp/`（已 gitignore，可随时清空）。
2. **密钥**：不得在仓库任何文件（含 fixtures、文档示例）写入明文 key 或内网真实地址；用 `sk-xxx`、`http://litellm.example:4000` 之类占位。
3. **依赖**：运行时只允许 peer 依赖 `@earendil-works/pi-ai` 与 `@earendil-works/pi-coding-agent`（声明为 `"*"`，不打包、不 import 打包产物）；新增运行时依赖须在 openspec design.md 说明理由。
4. **真实环境测试凭据**：凡需连接真实 LiteLLM 的验证，统一使用 `~/.agents/skills/opencode-litellm-config-sync/.env` 中的 `LITELLM_BASE_URL` / `LITELLM_API_KEY`。只在运行时读取、只在内存中使用；地址与 Key 不得写入仓库、fixtures、日志或文档。**不要**读取 `~/.config/opencode` 下用户自己的 Key。
5. **共享 core**：宿主无关逻辑以单副本方式复用平级仓库 `../opencode-litellm-provider` 的 `src/core/`；本仓库不得再复制一份，也不得让 core 反向依赖 pi。
6. **验证**：`bun run typecheck && bun test` 必须通过后再提交。
7. **提交**：conventional commits（`feat:` / `fix:` / `chore:` / `docs:`）；openspec 在途变更随实施一起提交，完成后 archive。
8. **agent skills 单副本**：skill 只维护在 `.agents/skills/`。若 `openspec init`/`update` 又为 Pi 生成了 `.pi/skills/`，删掉它（否则会出现同名 skill collision 提示）；日常刷新用 `openspec update --force`，它只重写 `.agents/skills/`。
9. **发版**：合入 `main` 的用户可见变更（`feat:` / `fix:`）应及时发版，**不要让 tag/Release 落后于 `main`**——`pi install git:` 用户跟随 `main` 没问题，但 `#vX.Y.Z` 锁定安装与 GitHub Release 附件依赖 tag。流程：先开 PR 提升 `package.json` 的 `version`（`feat:` → minor、`fix:` → patch；纯 `docs:`/`chore:` 不必发版）→ 合入后在 `main` 上打 `v<version>` tag 并推送（**打 tag 前向用户确认**；tag 必须等于 `v` + version，否则 `release.yml` 拒绝）→ workflow 自动创建 Release。发版后核对 GitHub Release 页面与 tag 是否对应**最新** main（`git ls-remote --tags` + `gh release list`）。**每次会话结束前自查：`v<version>` 是否落后于 `main` 的用户可见变更，落后则提醒发版。**
