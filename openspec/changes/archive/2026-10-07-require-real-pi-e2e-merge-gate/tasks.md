# Tasks

## 1. 同类审计与 precondition

- [x] 确认 Pi ruleset id 24010848 修改前状态：required checks=[CI]，enforcement/conditions/4 rules/bypass=[] 快照保存
  - 证据：before 快照记录；`scripts/check-merge-gate.mjs` 修复前会报告缺失（fail-closed）
- [x] 从真实 PR head check runs 确认 exact context `Real Pi 0.87.1 E2E`（app github-actions）
  - 证据：`gh api .../commits/81964ed.../check-runs` 输出记录

## 2. ruleset 修改与 postcondition

- [x] 仅在 `required_status_checks` 追加 `Real Pi 0.87.1 E2E`，其余参数逐字段一致；修改后复核 required checks=[CI, Real Pi 0.87.1 E2E] 且无其它漂移
  - 证据：after 快照 + `node scripts/check-merge-gate.mjs` exit 0

## 3. 漂移检查接入 CI

- [x] 新增 `scripts/check-merge-gate.mjs`（fail-closed）与 `package.json` 的 `test:merge-gate`，并在 CI 的 OpenSpec 步骤前执行
  - 证据：workflow step 定义 + 本地 exit 0

## 4. governance OpenSpec closure

- [x] scenarios 100% 自动化证据；strict validate 通过后 archive + canonical sync + 重新 strict validate
  - 证据：本地命令输出 + PR CI