# Design

## Context

基线 c98e57b877081fc4a9471ce772eeb6c130674dde / Pi插件0.10.0，编入Core a13f16fd983478572502f3896fd5509978027261。动机见proposal。实际provider注册16项，均reasoning=true、snapshot variants空。Core同名change的audit.md包含全部58规格盘点和问题P01–P08；其design.md D1–D8为语义真源，test-matrix.md T01–T34为跨仓库验收矩阵。

## Goals / Non-Goals

**Goals:** 在Pi最终注册、picker和请求中准确表达Core语义；默认诊断可读。
**Non-Goals:** 在Pi实现匹配、owner映射或价格权威；改凭据与端点状态模型；本阶段实施或更新dist。

## Decisions

### 宿主字段与推理

toProviderModels只接收Core publishable；contextWindow=limit.context、maxTokens=limit.output、input只映射Core明确支持且Pi可表达的text/image，不能为nontext模型伪造text；cost传Core有限非负参考价。reasoning严格读取supported/unsupported，缺verdict不从variant数量推断。

effort映射：none→off，其余受支持Pi level同名；全部未声明level置null。supported+无可选档位（[]、toggle或options缺失）使用全null表，并保持reasoning=true。真实pi-ai0.87.1的getSupportedThinkingLevels在省略map时补出默认档位；当前map.ts第37行早返回undefined与map.test.ts:433固定了错误。不得以reasoning=false规避宿主默认。全null表如何经过picker/clamp与API落为无effort必须由T29实测；有阻碍时修改适配层受支持的请求设置，不能伪称已配置正确。

budget_tokens沿用Core中立variant及Pi受支持high/max映射；注册接口不能注入每模型预算，需比对Pi实际thinkingBudgets和记录上限。若宿主做不到，不展示错误预算的档位并明确宿主限制，不把数值编码成map字符串。

| Core protocol | Pi API | base URL |
|---|---|---|
| chat | openai-completions | root/v1 |
| responses | openai-responses | root/v1 |
| messages | anthropic-messages | root（SDK附加/v1/messages） |

### 发现、缓存与诊断

refreshModels restore阶段保持无网络；network阶段按现有30秒freshness/force、5分钟默认轮询和catalog6小时缓存策略运行。成功空清单撤下，auth401/403清除，瞬时LiteLLM故障保留合法旧结果；models.dev故障消费Core的LKG/完整LL/withheld判定，不强制丢弃已有档位。不得在adapter再判定来源权威。

Core publication9 / snapshot2通过host models store存储；schema8/1不得直接恢复旧空档位和价格cap。既有endpoint/匿名URL-options restore scope、credential和activation边界保留。价格损坏由Core归零，不让host stored模型因价格拒绝整个目录；contextTierCap接受但忽略且不进新restore scope。

默认diagnostics保留endpoint状态、缓存年龄与runtime identity短值，模型段只显示来源、推理支持/档位、真实未配置原因与统计。移除“声明models_dev_provider恢复”及候选列表。主动audit增加公开canonical/record与字段来源allowlist，不复制route/URL/credentials，不自动写出。

### 与旧基线的差异

| 差异 | 理由 |
|---|---|
| LL优先/家族原厂表→Core官方、OC、OR | 用户指定优先级，不在Pi维护业务副本 |
| 无variant判false或省略map→保持支持且全null | SDK默认档位会扩大能力 |
| 272k价格截断→真实能力context | 价格不影响关键能力 |
| LL价格→Core参考价或0 | 价格nice to have |
| schema8与旧迁移fixtures→新策略快照/oracle | 已知错误行为不能永久锁定 |

## Risks / Trade-offs

Pi peer声明仍为现状，强制测试0.87.1与Node>=22.19.0，不扩大兼容承诺。全null、none映射和budget兼容风险以真实请求证据关闭。ProviderModelConfig没有独立tools开关，Core tools结论保留在审计，不能声称注册接口已表达tools=false或承诺禁止所有工具请求；实际16记录均tools=true，不受此限制。本轮不为此新增全局工具切换机制，非工具模型的宿主限制须在验收报告单列。旧schema离线升级暂不恢复，成功网络刷新后重建。真实16名单已获得，但上游deployment结构尚未采集，不能声称合成fixture就是现场数据。

## Migration Plan

设计审查后才能实施。Core先独立审核并获准合入main；Pi固定同一完整Core SHA更新构建。执行verify:dist、typecheck、bun test、test:package、strict/closure、真实test:e2e:pi；不可用mock取代。同步README、OpenSpec context和ADR，再按Scenario证据归档本新change。已有archive永不修改；本阶段只有proposal/design/deltas/tasks/设计材料。

真实验收沿Core矩阵T29/T31/T32：Pi自己安装固定candidate、隔离HOME/XDG/PI_CODING_AGENT_DIR、两本地endpoint独立credentials，检查16项模型及逐effort请求、无档位与不支持推理、价格故障/LKG/重启/auth/activation。回滚上一个固定插件tag，保留用户配置与凭据；合并发布另需授权。
