# Tasks

设计已获批准；Core #34 与宿主实施已完成 Review、合并和真实宿主验收。共享测试矩阵和16模型oracle位于Core同名change，具体Scenario映射与最终 main 证据见本仓库scenario-evidence.md。

## 1. 设计与依赖

- [x] 1.1 按用户Review修订整记录语义与16模型验收；撤回内部身份和协议阻断，T05/T06不实施。
- [x] 1.2 获得设计Review结论；确认Core已按独立PR授权合入并记录完整稳定SHA后才开始2–5。

## 2. 宿主映射与输入

- [x] 2.1 以单一Core SHA更新构建和dist/provenance；引入真实名称构造的合成发现输入与公开catalog子集到test/fixtures，T01/T28逐16项对比。
- [x] 2.2 更新map.ts的thinkingLevelMap/明确reasoning/text边界；T13–T15/T24/T30验证无默认扩张、不支持/无档位/未知区别，更新README映射说明。
- [x] 2.3 删除本地cap/旧provider权威假设，contextTierCap只接受不生效；T16/T17证明价格变更不影响模型发布与限制。

## 3. 快照与用户诊断

- [x] 3.1 消费Core9/2缓存契约并迁移restore scope；T18–T21/T25/T32覆盖价格容错、旧schema、重启、model_name、endpoint/凭据隔离及内部route/base_model变化不失效；同步升级说明。
- [x] 3.2 精简默认诊断并添加主动allowlist来源审计；T22/T23/T31贯穿Core→state→command/notify，不泄露URL/route/key，不提示models_dev_provider。
- [x] 3.3 更新新基线的测试预期、README、ADR与openspec/config.yaml旧context；同步本deltas及publication Purpose，T27检查无矛盾与错误fixture预期，历史archive不改。

## 4. 真实宿主验收

- [x] 4.1 使用真实Pi0.87.1的pi install安装不可变candidate commit/tag；隔离HOME/XDG/PI_CODING_AGENT_DIR、两个本地fake endpoints与独立credentials，留存package/Core SHA。
- [x] 4.2 执行T29：16项最终注册/picker逐字段断言、每声明effort实际请求、无档位和不支持推理请求、Chat/Responses/Messages路径与SDK初始化；mock/factory/package smoke不能替代。
- [x] 4.3 在真实宿主中注入价格错误、catalog outage、恢复、删除、auth、重启/activation并检查UI与注册一致；保存脱敏证据，逐Scenario回填自动化测试名/CI run。

## 5. 完成门禁

- [x] 5.1 运行verify:dist、typecheck、bun test、test:package、test:e2e:pi和validate:spec、test:openspec-closure、test:release-metadata；记录具体命令、退出码及未执行项。
- [x] 5.2 实现和证据齐全后使用CLI archive新change，完成strict/closure；PR依赖Core并按本次授权与仓库门禁合入。
- [x] 5.3 合并后finish_codebase_task核对准确main/index字节；Release作为独立阶段执行，固定provenance不跟随后续main重建。

收尾证据（2026-10-11）：Core #34 main SHA 为 cf797e953eb1f6de8e7c3e0fd5e98094398c26f9；Pi #55 经 Review 的 HEAD 11d07bdc5e1bdf126b6d56133a06bf6696af667b squash 合并为 main SHA 6007c4b5d5588ad2dfa14d1577c00df7ce74d844。该 SHA 的完整 CI/真实 Pi 0.87.1 E2E run 38101305088 与 main 索引发布 run 38101401299 均成功，finish_codebase_task READY；T28–T32最终证据见scenario-evidence.md。v0.10.1单独发版阶段保持dist固定Core provenance，不改冻结oracle或历史archive。
