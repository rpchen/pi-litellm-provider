# 贡献说明

## 分支与合并

- 功能开发在分支完成，通过面向 `main` 的 pull request 合入。
- `main` 只接受通过 required `CI` check 的 PR。

## 提交信息

使用 conventional commits：`feat:` / `fix:` / `chore:` / `docs:`，与仓库历史保持一致。

## 本地校验

```bash
npm ci
bun run typecheck
bun test
npm run validate:spec
npm run test:openspec-closure
npm run test:release-metadata
# 宿主契约变更：先安装 @earendil-works/pi-coding-agent@0.87.1，
# 再将 E2E_PACKAGE_SPEC 指向待验证的不可变 Git commit/tag：
E2E_PACKAGE_SPEC=git:github.com/rpchen/pi-litellm-provider@<sha> npm run test:e2e:pi
```

## 规格变更

功能与行为变更走 OpenSpec：`openspec/changes/` 下先立提案（proposal / design / specs / tasks），实施完成并验证后 archive。

`npm run test:openspec-closure` 会拒绝 tasks 已全部完成但仍留在 active `openspec/changes/` 的 change，并核对所有 archived delta 是否已同步到 canonical `openspec/specs/`；实现完成后必须使用 OpenSpec CLI archive，再执行 strict validation 与新的 closure gate；不得手工移动目录代替 archive。

## 测试完成标准

测试治理以 `litellm-discovery-core/docs/testing-standard.md` 为权威来源。提交行为变更时必须同时满足：

- OpenSpec 每个 Scenario 都能映射到至少一个自动化验收证据；
- 安全、凭据、持久化、fallback、destructive failure 等边界有真实负向输入；
- 新增用户可见功能至少有一条纵向自动化链路，Pi 功能应覆盖到 command / UI；
- PR 描述提供 `Requirement / Scenario → Test Evidence`，说明破坏某 Scenario 时哪项测试会失败；
- CI 全绿是必要条件，但不能替代 Scenario 级闭环；
- 涉及 Pi 宿主 API、provider/model、credential/login、command/UI、插件安装/加载或用户可见宿主行为时，必须通过 `Real Pi 0.87.1 E2E`。该门禁必须用 Pi 自己的 `pi install` 安装固定 Git 候选，并在隔离 agent dir 中验证真实宿主状态；mock/factory/package smoke 不能替代。

## 用户文档门禁

凡变更会影响用户实际使用方式（安装/升级、配置、命令、默认值、刷新/缓存、错误降级、兼容或迁移流程），必须在**同一个 PR**更新 README，并在 PR 中标明更新章节。若确认没有用户可见变化，则明确写 `No README change: no user-visible behavior`。

OpenSpec 中包含用户可见 Scenario 时，tasks 必须包含 README 更新任务。README 缺失时，即使测试和 CI 全绿也不算完成。

## 发版

Release 由 tag 触发（`release.yml` 监听 `v*.*.*`，并强校验 tag == `v` + `package.json.version`）：

1. 用户可见变更（`feat:` / `fix:`）合入 `main` 后，开 PR 提升 `package.json` 的 `version`（`feat:` → minor、`fix:` → patch；纯 `docs:` / `chore:` 不必发版）
2. release PR 同时保证 package/lockfile 版本与 README “当前发行版”示例一致，并通过 `test:release-metadata`
3. 合并后等待同一 main commit 完整 CI 通过，再创建指向该 SHA 的不可移动 tag
4. 在 `main` 上打 `v<version>` tag 并推送（打 tag 前与维护者确认）
5. workflow 自动完成全套门禁 → tagged Git 包冒烟 → `npm pack` + SHA256 → 创建 GitHub Release（附 `.tgz` / `.sha256` 与安装命令），发布后核对 tag SHA / Release / 附件

`pi install git:`（无 ref）用户始终跟随 `main`；`#vX.Y.Z` 锁定安装与 Release 附件依赖 tag——合入用户可见变更后记得检查 tag 是否落后于 `main`。
