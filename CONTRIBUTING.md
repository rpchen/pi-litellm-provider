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
