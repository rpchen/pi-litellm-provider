## ADDED Requirements

### Requirement: 复用完整行为矩阵必须引用实际成功的完整运行
required check `Real Pi latest E2E` SHALL 每次运行都执行当前候选的真实 delivery 验证；只有当本轮候选与 harness 的真实 Git 内容、精确宿主版本与锁内容、Node/npm、runner 镜像以及约定配置都与此前一次**实际成功的完整矩阵**运行逐项一致时，才 MAY 跳过完整矩阵并引用那次运行的结论。基线 MUST 来自同仓库已完成且成功的 CI 运行中真实的完整矩阵结果（含运行号与 attempt、候选与 harness SHA、宿主输入与完整分组结论），MUST NOT 来自 delivery、专项或 smoke 结果，MUST NOT 按 PR 标题、分支名或相似 diff 推断。

缺失、无法核实或不一致的任何输入（包括基线缺失、复用的运行 attempt 不是当前最新 attempt、宿主 latest 版本变化、锁内容变化、候选树或 harness 树非允许字段差异）MUST 退化为完整矩阵运行，MUST NOT 用"看起来相同"的证据复用。复用分支 MUST NOT 伪称本轮跑过完整矩阵：门禁汇总 MUST 显示本轮 scope、真实结论与被引用运行的位置。

#### Scenario: [E2E-REUSE-ACTUAL] 只从真实成功的完整运行复用
- **WHEN** 当前候选与 harness、宿主输入和约定配置与一次已完成成功的完整矩阵运行逐项一致，且该运行的分组与步骤结论可从实际运行记录核实
- **THEN** 本轮只运行 delivery 验证并引用该运行，汇总同时给出本轮 scope 与被引用运行

#### Scenario: [E2E-REUSE-MISSING] 缺证据一律完整跑
- **WHEN** 基线缺失、证据不完整、`deliveryInputs.complete` 为 `false` 或宿主/runner/Node 输入不同
- **THEN** 本轮运行完整矩阵步骤，required check 的结论来自本轮实际执行

#### Scenario: [E2E-REUSE-DELIVERY-ONLY] delivery 结论不能当基线
- **WHEN** 一次运行只执行了 delivery 范围
- **THEN** 它不产生可复用的完整矩阵基线，后续运行不得以它为依据跳过完整矩阵

#### Scenario: [E2E-REUSE-STALE-ATTEMPT] 重跑后的旧 attempt 不复用
- **WHEN** 同一运行被重跑，而候选引用的是重跑前 attempt 的结果
- **THEN** 该结果不被接受为当前基线，本轮退化为完整矩阵运行
