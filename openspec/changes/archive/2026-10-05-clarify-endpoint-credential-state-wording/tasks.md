# Tasks: clarify-endpoint-credential-state-wording

## 1. Spec delta

- [x] 1.1 编写 `specs/endpoint-management/spec.md` delta：MODIFIED `Endpoint listing`、`Add endpoint`、`Credential management`、`Delete endpoint`，把 credential 状态表达从 Connected / Not connected 改为已保存/未保存 API Key 等四种标签；`Credential management` 显式写明标签不得称为 Connected / Not connected。验证：`openspec validate --strict`。
- [x] 1.2 同步更新 canonical `openspec/specs/endpoint-management/spec.md`（MODIFIED requirement 语义与 delta 一致），archive 后通过 `openspec validate --all --strict --no-interactive` 与 `npm run test:openspec-closure`。

## 2. 用户可见文案 fix

- [x] 2.1 `src/extension/endpoint-management.ts` Add 成功 notify：`未启用、未连接` → `未启用、未保存 API Key`。
- [x] 2.2 `src/extension/discovery.ts` 两处 "Not connected" 注释改为按事实描述（no address resolved），不与 credential 状态标签冲突。
- [x] 2.3 `scripts/e2e-real-pi.mjs` 相关注释与断言信息字符串改为 saved/not-saved 表达（on-screen 文案断言已是新语义）。
- [x] 2.4 README 核查：状态模型/操作/排障文案已使用新语义，确认无需修改。
- [x] 2.5 重建 `dist/`（固定 core SHA），`verify:dist` 通过。

## 3. 测试

- [x] 3.1 `test/endpoint-management.test.ts`：Add 成功后断言 notify 包含 `未启用、未保存 API Key`，新增负向断言（不含 `已连接`/`未连接`/`connected`）；`[LIST-MULTI]` 测试名改为 saved/not-saved 表达。
- [x] 3.2 `test/endpoint-state.test.ts`：扩展 credentialLabel 负向断言（不含 `已连接`/`未连接`/`connected`/`disconnected`）。
- [x] 3.3 同步更新其余断言旧语义的测试。

## 4. 验证

- [x] 4.1 `bun run verify:dist`、`bun run typecheck`、`bun test`、`bun run test:package` 全部通过。
- [x] 4.2 `openspec validate --all --strict --no-interactive`、`npm run test:openspec-closure`、`npm run test:scenario-coverage`、`npm run test:release-metadata` 全部通过。
- [x] 4.3 全文审计：`src/`、`test/`、`README.md`、`scripts/e2e-real-pi.mjs` 中不再有把 credential 状态表达成已连接/未连接的用户可见文案；dicovery runtime 工程术语保留。CI Real Pi 0.87.1 E2E 绿。