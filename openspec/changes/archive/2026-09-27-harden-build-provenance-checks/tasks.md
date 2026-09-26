## 1. OpenSpec 与脚本接口

- [x] 1.1 扩展 `scripts/build.ts`，支持显式 SHA 与临时输出目录。
- [x] 1.2 新增 `scripts/verify-dist.ts`，按 provenance SHA 重建并执行零差异目录比较。
- [x] 1.3 在 `scripts/prepare-core.ts` 中拒绝脏缓存，并保留清晰错误信息。

## 2. CI、测试与文档

- [x] 2.1 将 CI 构建步骤改为 `bun run verify:dist`，新增 package script。
- [x] 2.2 增加提交产物差异和脏缓存拒绝的测试；继续覆盖 LiteLLM `/v1/model/info` fixtures。
- [x] 2.3 更新 `AGENTS.md`、`docs/decisions.md` 和相关 OpenSpec 规格，说明更新构建/复验边界。

## 3. 验收

- [x] 3.1 运行 `bun run build:dist` 生成并验证当前产物。
- [x] 3.2 运行 `bun run verify:dist`、`bun run typecheck`、`bun run test`、`bun run test:package`。
- [x] 3.3 运行 `npm run validate:spec`，并在真实 Pi 中隔离加载 `./extensions/index.ts`。
