## 1. OpenSpec 与构建输入

- [x] 1.1 固化 PR2 的 proposal/spec/design，并运行 `openspec validate --all --strict --no-interactive` 验证结构和中文文档完整
- [x] 1.2 实现 core 获取辅助脚本：更新构建解析 `litellm-discovery-core/main` SHA，复验模式接受 provenance SHA，按 SHA 缓存并校验 checkout；用脱敏输出验证不会打印 Key 或真实地址
- [x] 1.3 删除受 Git 管理的 `src/core/`，让 typecheck、Bun 测试和构建命令先准备同一 SHA 的生成缓存；验证 `git ls-files src/core` 为空且 `bun run typecheck` 使用准备后的 core 通过

## 2. Pi 产物与入口

- [x] 2.1 新增 `tsconfig.build.json` 与 `build:dist` 流程，把适配层、网络模块和固定 SHA 的 core 编译到 `dist`，生成包含 repository/branch/sha 的 `dist/core-provenance.json`；验证 `dist/extension/index.js` 与 `dist/core/*.js` 存在
- [x] 2.2 将 `extensions/index.ts` 改为转发到 `dist`，更新 `package.json` 的 scripts/files，保留两个 Pi peer dependency；验证入口不再 import 源码或平级仓库
- [x] 2.3 更新 `scripts/test-package.ts`，检查打包清单含入口、dist 与 provenance、未泄漏 `.tmp`/node_modules，并在临时隔离目录以禁用 lifecycle scripts 的方式加载包入口

## 3. 行为一致性测试

- [x] 3.1 把现有 core 单元测试改为消费构建期生成的独立 core 公共 API，不改变测试 fixtures；用 `test/fixtures/litellm-model-info.json` 和 `models-dev.json` 验证模型 id、协议、能力、上下文/输出限制和推理映射快照一致
- [x] 3.2 增加构建 provenance 与固定 SHA 复验测试：远端 main 变化时复验仍使用产物 SHA，且运行时模块不调用 GitHub/缓存路径
- [x] 3.3 运行 `bun test`、`bun run typecheck`、`bun run build:dist`、`bun run test:package`，记录可复验命令与结果

## 4. 宿主与文档验收

- [x] 4.1 在真实 Pi 中执行 `pi -e ./extensions/index.ts --list-models litellm`（使用脱敏/现有环境凭据，不写入日志），验证 provider 从 dist 加载且 refreshModels 链路可用
- [x] 4.2 在临时无平级仓库目录执行安装后的包入口加载，并用 `npm install --ignore-scripts` 或等效禁用 lifecycle scripts 验证不依赖现场构建
- [x] 4.3 更新 `AGENTS.md`、`docs/decisions.md` 与 README/构建说明，删除平级 `../opencode-litellm-provider/src/core/` 旧约定，写明更新构建与产物复验、core SHA、dist 提交和 PR3 边界
- [x] 4.4 提交前运行 `openspec validate --all --strict --no-interactive`、完整测试与 `git status --short`，确认仅有 Pi 仓库 PR2 变更且工作树干净后再创建 PR
