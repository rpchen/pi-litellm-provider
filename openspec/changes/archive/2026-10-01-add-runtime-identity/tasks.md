## 1. OpenSpec
- [x] 1.1 proposal / design / specs/runtime-identity + specs/model-audit-export（`openspec validate --all --strict --no-interactive` 通过）

## 2. Implementation
- [x] 2.1 `src/extension/runtime-identity.ts` canonical 对象
- [x] 2.2 `scripts/build.ts` 生成 `dist/runtime-identity.json`（digest 共享实现）
- [x] 2.3 `src/extension/diagnostics.ts` 使用 canonical identity（短形式块）+ snapshot 增加可选 `models`
- [x] 2.4 `src/extension/audit.ts` + `audit-file.ts` + `/litellm-audit-export` 命令（allowlist、无 baseUrl 泄露、与 identity 同源）
- [x] 2.5 `src/extension/index.ts` startup log（同一 identity）
- [x] 2.6 `scripts/verify-dist.ts` / `scripts/test-package.ts` 增加 identity ↔ bytes ↔ provenance 验证
- [x] 2.7 `dist/` 按现有 provenance SHA 重建（含 identity），`verify:dist` 通过

## 3. Tests（Specification Scenario Coverage = 100%）
- [x] 3.1 `test/runtime-identity.test.ts`（三字段、digest 合法、顺序稳定、路径归一、自排除、非法拒绝、rebuild 一致、变化敏感）
- [x] 3.2 `test/audit.test.ts`（allowlist、无 baseUrl/凭据泄露、identity 完整、与 diagnostics 同源）
- [x] 3.3 diagnostics / startup 同源断言
- [x] 3.4 distribution 负向测试（missing / malformed 拒绝）
- [x] 3.5 package test（tarball 包含、可安装后读取、无 `.git`/源码依赖、provenance 一致）
- [x] 3.6 每个 Scenario 在测试名或注释中带 `[SCENARIO-ID]`（15/15 覆盖，手工核对通过）

## 4. Real host E2E
- [x] 4.1 Real Pi 0.87.1 E2E 脚本已更新：真实安装 candidate 后验证 diagnostics 短值、audit 完整值与模型 allowlist、startup 同一 identity、不依赖 `.git`（本地 Pi 版本与 E2E 要求不符，待 CI 运行）

## 5. README
- [x] 5.1 `README updated: Runtime Identity（diagnostics / audit-export / startup log）与新增 /litellm-audit-export`

## 6. Closure
- [x] 6.1 `openspec archive add-runtime-identity` 后 `openspec validate --all --strict --no-interactive`，closure gate 通过（本提交即归档提交，CI 复验）

## Requirement / Scenario → Test Evidence

| Scenario | Evidence files |
|---|---|
| IDENTITY-FIELDS | test/runtime-identity.test.ts |
| DIGEST-DETERMINISTIC | test/runtime-identity.test.ts |
| SELF-EXCLUSION | test/runtime-identity.test.ts |
| DIAG-SHORT | test/diagnostics.test.ts |
| AUDIT-FULL | test/audit.test.ts, test/extension.test.ts |
| AUDIT-SAFE | test/audit.test.ts |
| STARTUP-LOG | test/extension.test.ts |
| VERIFY-STRICT | scripts/verify-dist.ts |
| PACKAGE-IDENTITY | scripts/test-package.ts |
| REPRODUCIBLE-BUILD | test/runtime-identity.test.ts |
| REAL-HOST-E2E | scripts/e2e-real-pi.mjs |
