## ADDED Requirements

### Requirement: 提交产物按 provenance 复验

CI 和发布前检查 MUST 读取已提交 `dist/core-provenance.json` 的完整 core SHA，按该 SHA 重建到临时目录，并使用零差异目录比较验证重建结果与已提交 `dist` 完全一致。校验不得解析或跟随当前 `core/main`。

#### Scenario: 提交产物过期

- **WHEN** 已提交 `dist` 没有包含 provenance SHA 对应构建的文件
- **THEN** 复验命令失败并报告产物差异

#### Scenario: 提交产物一致

- **WHEN** provenance 合法且重建结果与已提交 `dist` 完全一致
- **THEN** 复验命令成功，且不修改工作区中的 `dist`

### Requirement: core 缓存必须干净

构建在从缓存复制 core 源码前 MUST 拒绝存在任何已跟踪或未跟踪工作区修改的缓存 checkout。拒绝时 MUST 不生成使用该缓存的 Pi 产物。

#### Scenario: 缓存有未提交修改

- **WHEN** 指定 SHA 的缓存 checkout 存在未暂存、已暂存或未跟踪文件
- **THEN** 构建失败并指出缓存工作区脏，不能以原 SHA 继续编译

#### Scenario: 缓存干净

- **WHEN** checkout 的 HEAD 与请求 SHA 一致且工作区干净
- **THEN** 复制源码并继续构建，provenance SHA 与源码来源一致

### Requirement: 更新构建与复验边界清晰

更新构建 SHALL 解析当时的 `core/main`；复验已有产物 MUST 使用 provenance SHA。两种模式 MUST 使用同一份固定 SHA 源码完成类型检查、测试和编译。

#### Scenario: main 后续前进

- **WHEN** core `main` 在产物生成后继续前进
- **THEN** 对既有产物的复验仍使用原 provenance SHA 并保持结果可重复
