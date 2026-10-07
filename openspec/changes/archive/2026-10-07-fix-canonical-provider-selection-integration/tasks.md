# Tasks

## 1. Core 依赖更新

- [x] Core PR rpchen/litellm-discovery-core#29+#30（`fix-canonical-provider-selection-precedence`）合入 main 后，解析该 main SHA 并用 `bun run build:dist` 一次性更新 `dist/`（同一 SHA 全程复用，写入 `dist/core-provenance.json` 与 runtime identity digest）
  - 证据：`bun run verify:dist` 按 provenance SHA 重建并逐字节比较
- [x] `bun run typecheck` / `bun test` 在新 Core SHA 上全绿
  - 证据：本地命令输出 + PR CI

## 2. DeepSeek 固定 integration regression（Pi 最终宿主配置）

- [x] 新增 `test/publication.test.ts` 用例：DeepSeek 真实形态（LiteLLM descriptive 384000 + 官方 relation catalog）→ Core publication → `toProviderModelsWithPublication`，断言 `contextWindow=1000000`、`maxTokens=393216`、强负断言 `maxTokens != 943718`、selectionSource 保留
  - 证据：`bun test test/publication.test.ts`（canonical selection integration 组）
- [x] fallback-only（OpenRouter 943718 与 descriptive 冲突）→ 模型 withheld、注册列表不含该模型
  - 证据：同上
- [x] fallback 形态（OpenCode vs OpenRouter 同时存在）→ fallback = OpenCode，spec.id 不被改写
  - 证据：同上
- [x] fixture 复用 Core 的 sanitized 数据形态（`test/fixtures/models-dev-catalog-fixtures.ts` 等价数据），无模型特判
  - 证据：grep Pi `src/` 无模型名/`393216`/`943718` 硬编码；fixture 数据文件除外

## 3. Real Pi 0.87.1 E2E

- [x] 完整 CI 里 Real Pi E2E 继续 Green（不因 dist 更新漂移）
  - 证据：PR CI `Real Pi 0.87.1 E2E`

## 4. OpenSpec closure

- [x] scenarios 100% 自动化证据；`npm run validate:spec`、`test:scenario-coverage`、`test:openspec-closure` 全绿后 archive + canonical sync + strict re-validate
  - 证据：本地命令输出 + PR CI

## 5. 用户文档

- [x] README 旧优先级描述（OpenRouter、OpenCode 顺序）更新为新 precedence
  - 证据：grep 无旧顺序残留