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
```

## 规格变更

功能与行为变更走 OpenSpec：`openspec/changes/` 下先立提案（proposal / design / specs / tasks），实施完成并验证后 archive。

## 发版

Release 由 tag 触发（`release.yml` 监听 `v*.*.*`，并强校验 tag == `v` + `package.json.version`）：

1. 用户可见变更（`feat:` / `fix:`）合入 `main` 后，开 PR 提升 `package.json` 的 `version`（`feat:` → minor、`fix:` → patch；纯 `docs:` / `chore:` 不必发版）
2. 在 `main` 上打 `v<version>` tag 并推送（打 tag 前与维护者确认）
3. workflow 自动完成全套门禁 → tagged Git 包冒烟 → `npm pack` + SHA256 → 创建 GitHub Release（附 `.tgz` / `.sha256` 与安装命令）

`pi install git:`（无 ref）用户始终跟随 `main`；`#vX.Y.Z` 锁定安装与 Release 附件依赖 tag——合入用户可见变更后记得检查 tag 是否落后于 `main`。
