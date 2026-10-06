# Tasks

## 1. 删除 `/litellm-accept-degraded` 与 model-level degraded publication

- [x] 删除命令注册 / handler / usage 文案（`src/extension/index.ts`）
- [x] 删除 `acceptedDegradedIDs` controller 状态与 `degradationEligible` 字段
- [x] 删除 `DiscoveryDeps.publication.acceptedDegradedIDs`
- [x] 清理测试与 E2E 中的 accept-degraded 步骤
- [x] README 删除该命令与「接受不完整配置后继续发布」说明
- [x] 证据：`test/publication.test.ts`「the accept-degraded command does not exist and publication needs no user confirmation」；`grep -r "accept-degraded" src README.md` 无结果

## 2. Partial catalog / withheld / LKG 映射

- [x] `PublicationSummary` 改为 Core catalog 事实面（withheld / partial / unusable / regressions / discrepancies / conflicts / lkgDetail）
- [x] 17/20 场景：17 注册、3 withheld 且原因可见
- [x] withheld 不进入 provider model list，也不进入 snapshot
- [x] 恢复后自动发布，无需用户批准
- [x] 证据：`test/publication.test.ts`（partial catalog 与 LKG 用例）

## 3. Regression / 0-N 可见性

- [x] regression 与 unusable catalog 通过 `ctx.ui.notify` 明确呈现（含 Retry 指引）
- [x] 新模型首次 withheld 仅 diagnostics 可见（非打断）
- [x] `catalogNotice` / `takePendingNotice` 只提醒一次
- [x] 证据：`test/publication.test.ts`（diagnostics and regression UX 用例）

## 4. Acknowledgements

- [x] 底层 fingerprint + suppression 决策接入刷新路径
- [x] 不新增 `/litellm-acknowledge`（记录在 design D4）
- [x] 证据：`test/publication.test.ts`「pending notices are consumed exactly once per material change」

## 5. Diagnostics 事实面

- [x] `formatPublicationSummary` 输出总量 / partial / unusable / regression / LKG / withheld reasons / discrepancy / conflict
- [x] 不再出现「降级 / 接受」措辞
- [x] 证据：`test/publication.test.ts`「diagnostics explain availability, withheld reasons, LKG, discrepancy, and regression」

## 6. 文档与治理

- [x] README 更新（withheld / partial / LKG / Retry / diagnostics）
- [x] `npm run validate:spec`、`test:openspec-closure`、`test:scenario-coverage` 通过
- [x] Real Pi E2E 覆盖 partial catalog / LKG / regression / 0-N / no-accept-degraded
