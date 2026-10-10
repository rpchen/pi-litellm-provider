# Scenario 自动化证据

矩阵沿用 Core 同名 change，冻结 fixtures 未改。真实宿主使用 Pi 0.87.1 自身 installer，实际配置和请求均由宿主取得。实现候选 `06a4c217f97a70efd58875d83b174eaef9424c2d` 的 [CI 与真实 E2E](https://github.com/rpchen/pi-litellm-provider/actions/runs/38065205625) 均通过；后续诊断删减及两项后备来源测试由本 PR 最新 HEAD 的相同门禁复验。命令、结果和安装身份见 implementation.md。

| Capability | Requirement | Scenario / Matrix | 自动化证据 | 结果 |
|---|---|---|---|---|
| change-sync | 元数据不可用时消费 Core 恢复结果 | [T25] catalog超时 | test/discovery.test.ts — 元数据加载抛错可用有效LKG; scripts/e2e-real-pi.mjs injected catalog outage | PASS |
| discovery-quality-integration | Pi preserves selected limits and reference prices | [T28] 后备元数据 | test/metadata-priority.test.ts — official absent: selected opencode/openrouter record maps unchanged | PASS |
| discovery-resilience-integration | Consume one Core publication result | [T31] 只有Core判定 | test/diagnostics.test.ts — Core→state→/litellm-diagnostics→ui.notify; metadata-priority.test.ts actual LKG levels; real Pi diagnostics and notifications | PASS |
| discovery-snapshot | Pi current-policy snapshot restore | [T19] 旧策略不回放 | test/metadata-priority.test.ts — old policy/corrupt critical rejected; bad prices become zero | PASS |
| discovery-snapshot | Pi current-policy snapshot restore | [T21] scope不兼容 | test/metadata-priority.test.ts — different protocol scope rejected; test/discovery.test.ts endpoint identity restore isolation | PASS |
| discovery-snapshot | Pi current-policy snapshot restore | [T19] 价格损坏 | test/metadata-priority.test.ts — old policy/corrupt critical rejected; bad prices become zero | PASS |
| model-audit-export | Metadata provenance audit | [T23] 安全可追溯 | test/metadata-priority.test.ts — injected secret/URL/route absent from diagnostics and audit; audit public canonical/record | PASS |
| model-discovery | 消费 Core 整记录配置 | [T01] 完整16项 | test/metadata-priority.test.ts — all 16 publish; exact final host limits, capabilities, cost and selectable levels | PASS |
| model-discovery | 消费 Core 整记录配置 | [T08] 内部信息变化 | test/metadata-priority.test.ts — catalog outage retains configuration across internal route/deployment changes | PASS |
| model-discovery | 消费 Core 整记录配置 | [T10] 明确能力值 | test/map.test.ts — input 只保留已知 text/image; test/metadata-priority.test.ts supported-empty and unsupported stay distinct | PASS |
| model-discovery | 消费 Core 整记录配置 | [T03] 官方记录不存在 | test/metadata-priority.test.ts — official absent: selected opencode/openrouter record maps unchanged | PASS |
| model-discovery | 精确宿主推理选项映射 | [T13] GPT各自档位 | test/metadata-priority.test.ts — 16 exact final host configurations; scripts/e2e-real-pi.mjs 16-model phase | PASS |
| model-discovery | 精确宿主推理选项映射 | [T14] 支持无档位 | test/metadata-priority.test.ts — supported-empty and unsupported stay distinct; test/map.test.ts 无档位所有额外档位 null | PASS |
| model-discovery | 精确宿主推理选项映射 | [T29] 真实宿主请求 | scripts/e2e-real-pi.mjs — immutable install, 16 final registrations/picker lists, 60 actual requests; no-effort/unsupported/Messages controls | PASS |
| model-discovery | 原始模型名与可选参考价 | [T16] 价格缺失或错误 | test/metadata-priority.test.ts — bad/zero/missing prices; scripts/e2e-real-pi.mjs price-error refresh | PASS |
| model-discovery | 原始模型名与可选参考价 | [T17] 原272k价格阶梯 | test/metadata-priority.test.ts — tier option never alters availability/limits; GPT1050000 assertion | PASS |
| pi-integration | Pi explicit model capability mapping | [T29] 支持无档位 | scripts/e2e-real-pi.mjs — immutable install, 16 final registrations/picker lists, 60 actual requests; no-effort/unsupported/Messages controls | PASS |
| pi-integration | Pi explicit model capability mapping | [T14] 不支持推理 | test/metadata-priority.test.ts — supported-empty and unsupported stay distinct; test/map.test.ts 无档位所有额外档位 null | PASS |
| provider-diagnostics | Model metadata summary | [T22] 匹配成功 | test/metadata-priority.test.ts — diagnostics and audit actual metadata, 命中16/16 | PASS |
| provider-diagnostics | Model metadata summary | [T31] 诊断纵向一致 | test/diagnostics.test.ts — Core→state→/litellm-diagnostics→ui.notify; metadata-priority.test.ts actual LKG levels; real Pi diagnostics and notifications | PASS |
| publication | Current Core configuration cache | [T19] 策略迁移 | test/metadata-priority.test.ts — old policy/corrupt critical rejected; bad prices become zero | PASS |
| publication | Core publication controls host registration | [T01] 完整16模型 | test/metadata-priority.test.ts — all 16 publish; exact final host limits, capabilities, cost and selectable levels | PASS |
| publication | Core publication controls host registration | [T03] 合法后备记录 | test/metadata-priority.test.ts — official absent: selected opencode/openrouter record maps unchanged | PASS |
| publication | Core publication controls host registration | [T30] 非法关键上限 | test/map.test.ts — generic operational-limit guard; test/publication.test.ts partial catalog | PASS |
| publication | Pi reasoning support without implicit levels | [T29] 无档位不补默认 | scripts/e2e-real-pi.mjs — immutable install, 16 final registrations/picker lists, 60 actual requests; no-effort/unsupported/Messages controls | PASS |
| publication | Pi reasoning support without implicit levels | [T14] 不支持推理 | test/metadata-priority.test.ts — supported-empty and unsupported stay distinct; test/map.test.ts 无档位所有额外档位 null | PASS |
| publication | Host handling of metadata outages | [T18] catalog失败 | test/metadata-priority.test.ts — catalog outage; scripts/e2e-real-pi.mjs publication/LKG phase | PASS |
| publication | Host handling of metadata outages | [T16] 价格故障 | test/metadata-priority.test.ts — bad/zero/missing prices; scripts/e2e-real-pi.mjs price-error refresh | PASS |
| publication | Host handling of metadata outages | [T20] 模型已删除 | test/metadata-priority.test.ts — deletion removes it; scripts/e2e-real-pi.mjs successful empty/delete | PASS |
| shared-core-build | Pi single Core implementation | [T34] 新行为与固定SHA | bun run verify:dist + test:package; dist/core-provenance.json cf797e953eb1f6de8e7c3e0fd5e98094398c26f9 | PASS |
