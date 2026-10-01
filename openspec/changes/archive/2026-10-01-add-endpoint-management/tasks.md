## 1. OpenSpec
- [x] 1.1 proposal / design / specs/endpoint-management（`openspec validate --strict` 通过）

## 2. Implementation
- [x] 2.1 `src/extension/fs-lock.ts`（宿主 `proper-lockfile` 兼容的目录锁 + 原子写）
- [x] 2.2 `src/extension/config-store.ts`（litellm.json 非破坏性 add/edit/delete、legacy 迁移、冲突检测）
- [x] 2.3 `src/extension/host-state.ts`（auth.json 凭据、models-store.json 清理）
- [x] 2.4 `src/extension/endpoint-management.ts` + `index.ts` 接线（保留 all/none/<id> 参数）
- [x] 2.5 activation 原子写；`bunfig.toml` + `test/setup.ts` 修复测试未隔离真实 `~/.pi/agent`（基线 8 个失败）
- [x] 2.6 `dist/` 按不变的 core SHA `8e155e0` 重建，`verify:dist` 通过（core 无变更）

## 3. Tests（Specification Scenario Coverage = 100%，`npm run test:scenario-coverage` / `bun run test:scenario-coverage` 强制）
- [x] 3.1 每个 Scenario 在测试名或注释中带 `[SCENARIO-ID]`，下表由该脚本生成
- [x] 3.2 `test/fs-lock.test.ts` `test/config-store.test.ts` `test/host-state.test.ts` `test/endpoint-management.test.ts`（贯穿 Core 校验 → 配置/凭据文件 → command/UI 的纵向用例）

## 4. Real host E2E
- [x] 4.1 Real Pi 0.87.1 E2E：`scripts/e2e-real-pi.mjs` 通过 `pi install` 安装后，用 RPC `extension_ui_request/response` 回答宿主真实 select/input/confirm 对话框，覆盖三阶段：①既有 activation/limits 契约；②explicit endpoint 全流程（add → connect → activate → 模型可见 → edit Base URL（高级字段保留）→ replace → disconnect → deactivate → delete → 重启后状态）；③legacy 全流程（文件态 Edit/Delete + `LITELLM_BASE_URL` 迁移到 `endpoints.default` 后 Edit/Delete，迁移确认、字段/凭据身份保持、重启不复活）

## 5. README
- [x] 5.1 `README updated: 管理 endpoint（/litellm-endpoints）`；同步删除“完整 CRUD 不在范围内”的旧说明

## 6. Closure
- [x] 6.1 `openspec archive add-endpoint-management` 后 `openspec validate --all --strict --no-interactive`（随实施同一 PR 归档）

> 发版（feat → minor，需用户确认后打 tag）不属于本 change 的任务，见 PR 说明。

## Requirement / Scenario → Test Evidence

| Scenario | Evidence files |
|---|---|
| HOST-UI | test\endpoint-management.test.ts |
| LIST-EMPTY | test\endpoint-management.test.ts |
| LIST-SINGLE | test\endpoint-management.test.ts |
| LIST-MULTI | test\endpoint-management.test.ts |
| LIST-EXTERNAL | test\endpoint-management.test.ts |
| LIST-LEGACY-GHOST | test\endpoint-management.test.ts |
| ADD-OK | test\config-store.test.ts, test\endpoint-management.test.ts |
| ADD-DUP | test\config-store.test.ts, test\endpoint-management.test.ts |
| ADD-BAD-ID | test\config-store.test.ts, test\endpoint-management.test.ts |
| ADD-BAD-URL | test\config-store.test.ts, test\endpoint-management.test.ts |
| ADD-INACTIVE | test\endpoint-management.test.ts |
| ADD-PRESERVE | test\config-store.test.ts, test\endpoint-management.test.ts |
| ADD-LEGACY | test\config-store.test.ts, test\endpoint-management.test.ts |
| ADD-ROLLBACK | test\endpoint-management.test.ts |
| EDIT-URL | test\config-store.test.ts, test\endpoint-management.test.ts |
| EDIT-ID-READONLY | test\config-store.test.ts, test\endpoint-management.test.ts |
| EDIT-PRESERVE | test\config-store.test.ts, test\endpoint-management.test.ts |
| EDIT-ATOMIC | test\config-store.test.ts, test\endpoint-management.test.ts, test\fs-lock.test.ts |
| EDIT-ISOLATED | test\config-store.test.ts, test\endpoint-management.test.ts |
| LEGACY-MIGRATE | test\config-store.test.ts, test\endpoint-management.test.ts |
| CRED-CONNECT | test\endpoint-management.test.ts, test\host-state.test.ts |
| CRED-REPLACE | test\endpoint-management.test.ts, test\host-state.test.ts |
| CRED-DISCONNECT | test\endpoint-management.test.ts, test\host-state.test.ts |
| CRED-NO-ECHO | test\endpoint-management.test.ts |
| CRED-ACTIVATION-INDEPENDENT | test\endpoint-management.test.ts |
| CRED-LOGIN-CONSISTENT | test\endpoint-management.test.ts, test\host-state.test.ts |
| CRED-INVALID-KEY | test\endpoint-management.test.ts, test\host-state.test.ts |
| CRED-CORRUPT-STORE | test\endpoint-management.test.ts, test\host-state.test.ts |
| ACT-TOGGLE | test\endpoint-management.test.ts |
| ACT-ZERO | test\endpoint-management.test.ts |
| ACT-CRED-INDEPENDENT | test\endpoint-management.test.ts |
| ACT-IMMEDIATE | test\endpoint-management.test.ts |
| DEL-CONFIRM | test\endpoint-management.test.ts |
| DEL-CANCEL | test\endpoint-management.test.ts |
| DEL-CLEANUP | test\endpoint-management.test.ts, test\host-state.test.ts |
| DEL-ISOLATED | test\config-store.test.ts, test\endpoint-management.test.ts, test\host-state.test.ts |
| DEL-NO-GHOST | test\endpoint-management.test.ts |
| DEL-PARTIAL-FAILURE | test\endpoint-management.test.ts |
| CFG-NON-DESTRUCTIVE | test\config-store.test.ts |
| CFG-PARSE-FAIL | test\config-store.test.ts, test\endpoint-management.test.ts |
| CFG-CONFLICT | test\config-store.test.ts |
| CFG-LOCK | test\fs-lock.test.ts |
| HOST-PERM | test\host-state.test.ts |
