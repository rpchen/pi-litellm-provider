# Require Real Pi E2E Merge Gate

## Why

Pi `Protect main` ruleset（ruleset id 24010848）此前只把 `CI` 作为 required status check，而完整 CI 里早已存在 `Real Pi 0.87.1 E2E` job。本轮 OpenCode 治理审计（change `require-real-opencode-e2e-merge-gate`）发现 Pi 存在完全相同的缺口：`CI` 成功而 Real Pi E2E 失败的 release PR 理论上仍满足 required-check 合并条件。经确认该修改与共享 `docs/testing-standard.md` 的 Real Host E2E 合并前执行要求一致且改动极小（仅向既有 required_status_checks 追加一个已存在的 context），作为同类治理修复处理。

精确 required context 名称从真实 PR head check runs 确认：PR #49/#50 的 check runs 均发布 `CI` 与 `Real Pi 0.87.1 E2E` 两个 context（app: github-actions）。

## What Changes

- `Protect main` ruleset 的 `required_status_checks` 从 `[CI]` 扩展为 `[CI, Real Pi 0.87.1 E2E]`（real check-run context）。
- 其余 ruleset 参数冻结不动：active enforcement、squash-only、无 bypass actor、review-thread resolution、deletion / non-fast-forward。
- 新增 `scripts/check-merge-gate.mjs` 治理漂移检查并接入 CI；ruleset 被改回只有 `CI` 时 CI 变红。

## Impact

- Affected specs: `release-governance`（MODIFIED + ADDED）
- Affected code: `.github/workflows/ci.yml`、`scripts/check-merge-gate.mjs`（新）、`package.json`（新增 `test:merge-gate`）。产品源码与 dist 不变。