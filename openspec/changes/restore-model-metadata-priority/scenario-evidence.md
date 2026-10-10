# Scenario 证据计划

实施前每项均为planned；设计数据验证不能替代业务与真实宿主验收。实施时补具体文件、test名称、CI run与结果。矩阵T编号定义在Core同名change/test-matrix.md。

| Capability | Requirement | Scenario / Matrix | 计划证据 | 当前状态 |
|---|---|---|---|---|
| change-sync | 元数据不可用时消费 Core 恢复结果 | [T25] catalog超时 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-quality-integration | Pi preserves selected limits and reference prices | [T28] 后备元数据 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-resilience-integration | Consume one Core publication result | [T31] 只有Core判定 | Core→state→command/RPC→UI纵向 | planned，未实施 |
| discovery-snapshot | Pi current-policy snapshot restore | [T19] 旧策略不回放 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Pi current-policy snapshot restore | [T21] scope不兼容 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| discovery-snapshot | Pi current-policy snapshot restore | [T19] 价格损坏 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| model-audit-export | Metadata provenance audit | [T23] 安全可追溯 | audit 安全负向 | planned，未实施 |
| model-discovery | 消费 Core 整记录配置 | [T01] 完整16项 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| model-discovery | 消费 Core 整记录配置 | [T08] 内部信息变化 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| model-discovery | 消费 Core 整记录配置 | [T10] 明确能力值 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| model-discovery | 消费 Core 整记录配置 | [T03] 官方记录不存在 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| model-discovery | 精确宿主推理选项映射 | [T13] GPT各自档位 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| model-discovery | 精确宿主推理选项映射 | [T14] 支持无档位 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| model-discovery | 精确宿主推理选项映射 | [T29] 真实宿主请求 | 真实 Pi 0.87.1 E2E | planned，未实施 |
| model-discovery | 原始模型名与可选参考价 | [T16] 价格缺失或错误 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| model-discovery | 原始模型名与可选参考价 | [T17] 原272k价格阶梯 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| pi-integration | Pi explicit model capability mapping | [T29] 支持无档位 | 真实 Pi 0.87.1 E2E | planned，未实施 |
| pi-integration | Pi explicit model capability mapping | [T14] 不支持推理 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| provider-diagnostics | Model metadata summary | [T22] 匹配成功 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| provider-diagnostics | Model metadata summary | [T31] 诊断纵向一致 | Core→state→command/RPC→UI纵向 | planned，未实施 |
| publication | Current Core configuration cache | [T19] 策略迁移 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Core publication controls host registration | [T01] 完整16模型 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Core publication controls host registration | [T03] 合法后备记录 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Core publication controls host registration | [T30] 非法关键上限 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Pi reasoning support without implicit levels | [T29] 无档位不补默认 | 真实 Pi 0.87.1 E2E | planned，未实施 |
| publication | Pi reasoning support without implicit levels | [T14] 不支持推理 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Host handling of metadata outages | [T18] catalog失败 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Host handling of metadata outages | [T16] 价格故障 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| publication | Host handling of metadata outages | [T20] 模型已删除 | Core/adapter 对应矩阵单元与集成测试 | planned，未实施 |
| shared-core-build | Pi single Core implementation | [T34] 新行为与固定SHA | 固定provenance/package消费者 | planned，未实施 |
