# Spec Delta

## MODIFIED Requirements

### Requirement: models.dev catalog 来源与形状

Pi SHALL 继续从 `https://models.dev/catalog.json`（或现有合法自定义测试/镜像入口）读取同一 catalog snapshot，并保留 60 秒超时、60 秒失败退避、失败降级为空对象和 Core 形状校验。成功 catalog SHALL 由本地内存 cache 保留，不再按固定 6 小时 TTL 过期；最新网络 catalog 只由新增模型的本地匹配未命中驱动。

#### Scenario: 默认拉取 catalog 快照

- **WHEN** 扩展首次发现至少一个需要元数据匹配的模型且无自定义 URL
- **THEN** 请求 `https://models.dev/catalog.json`，成功后复用本地快照，不请求 `api.json`

#### Scenario: catalog 不可用时降级不断

- **WHEN** catalog 获取失败或形状不可用
- **THEN** 本轮按 Core unavailable 路径完成，并记录一次脱敏 warning

#### Scenario: 模型列表不变

- **WHEN** LiteLLM 成功返回的可注册 `model_name` 集合与上次成功发现相同
- **THEN** Pi 复用已注册配置，不重新执行 models.dev 匹配，也不请求 models.dev

#### Scenario: 新增模型本地命中

- **WHEN** LiteLLM 集合新增模型且本地 catalog 有该模型的可选记录
- **THEN** 只处理新增模型并复用本地 catalog，不请求最新 catalog

#### Scenario: 新增模型本地未命中

- **WHEN** LiteLLM 集合新增模型且本地 catalog 没有该模型的可选记录
- **THEN** 请求最新 catalog，并只用最新结果处理新增模型

#### Scenario: 仅删除模型

- **WHEN** LiteLLM 成功集合只删除已有模型而没有新增模型
- **THEN** 撤销被删除模型的注册，未变化模型保持不变，且不请求 models.dev

#### Scenario: 同名内部路由变化

- **WHEN** `model_name` 不变但 route、`base_model` 或 deployment ID 变化
- **THEN** 已注册配置保持不变，不触发元数据匹配或 models.dev 请求
