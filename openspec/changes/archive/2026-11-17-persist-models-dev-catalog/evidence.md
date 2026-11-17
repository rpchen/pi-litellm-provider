# 验证证据

## 当前候选与 CI

- 源码候选：`73e9ca1f7749a700d6801d3a7d40de24597669bb`。
- [CI run 44047126526](https://github.com/rpchen/pi-litellm-provider/actions/runs/44047126526) 常规 CI 与 Real Pi latest E2E 均成功；真实宿主执行 full 矩阵，并成功上传完整基线。已回读 job 133915491489 的完整矩阵步骤，非仅 delivery probe。
- CI 覆盖 typecheck、verify:dist、产品测试、package、场景覆盖、严格 OpenSpec、closure、release metadata、原生索引及 E2E 辅助门禁。
- 本地产品测试 274 pass / 3 Windows 平台 skip；本地 codebase-memory 42 pass；固定产物与 package 复验通过。

## Scenario 对应

- 成功公开目录跨重启保留：`test/catalog-persistence.test.ts` 的 restart reads the successful disk catalog without contacting models.dev；`test/incremental-discovery.test.ts` 的 `[CATALOG-RESTART]` 贯穿磁盘目录 → Core → Pi state/注册，并确认成功空清单仍撤销模型。
- 最新请求失败保留完整目录：failed latest request preserves disk catalog across another restart；invalid latest catalog cannot replace the previous complete catalog。
- 无效缓存与来源隔离：invalid disk content is ignored and mirror URLs do not reuse another source。
- 重启后新增模型元数据暂不可用：`[CATALOG-RESTART-NEW]` 确认旧模型由完整本地匹配/LKG 保留，新模型在源恢复后重试成功。
- LKG 独立负向边界：explicit E2E eviction removes both cache layers to exercise genuine LKG fallback；真实 Pi full E2E 的故障注入显式移除两个测试缓存层，保留原 LKG/withheld 断言。
- 旧实现负向回放 `.tmp/catalog-negative/result.txt`：新缓存测试 3 fail / 1 pass。

## 范围与复盘

根因机制为跨重启丢失公开目录，非具体模型特例；此次只改 adapter 的网络缓存与既有 LKG 捕获时机。沿用 Core 形状校验、匹配算法与发布门槛，Core SHA 保持 `90adfe8b0cde94ece261867997990b6f36d3e984`。

公开目录按来源 URL 隔离，不保存 LiteLLM 数据或凭据；重启仍解析本地目录，本地命中无需网络。首次安装无缓存仍需联网。README 与正式规格同步；未合并、未发版，不把本机恢复当成候选代码验收。

OpenCode 对应 PR：https://github.com/rpchen/opencode-litellm-provider/pull/78，两个 adapter 独立交付，无 Core 合入依赖。
