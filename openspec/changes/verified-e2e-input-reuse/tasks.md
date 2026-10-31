# Tasks

## 1. 证据契约与自检（脚本内纯函数）

- [x] 1.1 在 `scripts/e2e-real-pi.mjs` 增加 `parseScopeValue()`，`E2E_SCOPE` 未设置等价 `full`、`delivery` 只接受精确值、其他值直接失败；用 `--self-check` 覆盖合法/非法输入
- [x] 1.2 实现 `deliveryInputs` 的采集与归一化（实际安装克隆 manifest、克隆 SHA、依赖/peer 检查、宿主 loader alias 检查、SHA/版本归一化），并用 `--self-check` 覆盖"额外依赖被拒""peer 不在允许集合被拒""SHA 不符被拒"等负向输入
- [x] 1.3 在 `package.json` 增加自检入口并本地运行通过（`node scripts/e2e-real-pi.mjs --self-check`），不依赖宿主与网络

## 2. full / delivery 范围实现

- [x] 2.1 把既有完整矩阵整体搬入 `runFullScope()`（断言逐字不变），并为其补齐 `deliveryInputs` 采集；本地 `E2E_SCOPE` 缺省路径必须仍走完整矩阵
- [x] 2.2 实现 `runDeliveryScope()`：真实 `pi install` 固定 commit → 真实加载与 command/registry 身份 → provenance/Runtime Identity → 一次真实模型请求（chat 协议），任一失败非零退出
- [x] 2.3 实现报告写入（`E2E_TIMING_FILE`）：`scope`/`group`/`status`/`hostInput`/`deliveryInputs`，在临时 HOME 清理前写入、失败时不掩盖真实结论，并用 `--self-check` 覆盖报告组装与 `status` 取值
- [x] 2.4 运行既有 fixture 驱动的单元/集成测试（`bun run test`，含 `test/fixtures/metadata-priority` 的固定 `/v1/model/info` 样本）确认发现语义未被改动；`bun run typecheck` 通过

## 3. CI 接线

- [x] 3.1 改写 `.github/workflows/ci.yml` 的必需 job `Real Pi latest E2E`：保持 job 名称、Node 22.23.4 与 `release.yml` 不变；加入宿主一次性 resolve/install到私有prefix，直接复用该目录 + PATH/实际二进制校验（`--host-package @earendil-works/pi-coding-agent --host-command pi`）
- [x] 3.2 在同一 job 内先跑 delivery 探测，再按 `e2e-validation.mjs plan` 的 `verification-mode` 决定是否运行固定名步骤 `Run full real Pi host E2E`，只对 full 运行 `record` 并上传 `e2e-full-validation`（文件 `validation.json`）；job 声明 `actions: read`
- [x] 3.3 用静态检查确认 workflow 语法与引用一致（job 名称/步骤名/artifact 名/权限逐字核对），通用助手由父整合后入库，各仓独立运行；实际分流仍待Linux CI验收

## 4. 文档

- [x] 4.1 新增 `docs/e2e-ci.md`：记录两种 scope 的真实行为、报告字段与写入时机、`deliveryInputs` 的取证依据（Pi 1.4.0 的 clone + `npm install --omit=dev --legacy-peer-deps`、loader alias）、复用门槛、失败语义、dev 锁不约束运行时、以及本地运行命令
- [x] 4.2 文档中显式标注通用助手随仓库交付，实际Linux集成验收仍待运行，且 Pi 侧不做并行/矩阵裁剪、不改 tag 门禁

## 5. 集成验收

- [ ] 5.1 真实 CI 中确认：delivery 运行的报告与结论、full 运行的既有断言全绿、`e2e-full-validation` 只在 full 成功时上传，且必需 check 名称仍为 `Real Pi latest E2E`
- [ ] 5.2 真实 CI 验证"缺证据 → 完整跑"与"delivery 失败 → 门禁失败"至少各一次，并记录实际 job 的 scope 汇总
- [ ] 5.3 真实 CI 通过后再按 OpenSpec 归档流程归档本 change（未通过前保持 active）

父整合：静态导入共享助手，删除实施期间临时schema/动态导入后备；记录自身runner环境及实际PATH宿主执行文件摘要；Pi宿主不再重复安装，完整默认/tag路径不变。本地自检通过，Linux结果待回填。
