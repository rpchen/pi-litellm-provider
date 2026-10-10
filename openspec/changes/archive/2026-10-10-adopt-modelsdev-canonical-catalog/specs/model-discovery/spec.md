# Delta: model-discovery

## ADDED Requirements

### Requirement: models.dev catalog 来源与形状

Pi SHALL 从 `https://models.dev/catalog.json` 获取 models.dev 数据（单请求、
`providers` 与 `models` 同 snapshot、同 TTL epoch、同 failure domain；60 s 超时、
6 h TTL、60 s retry、失败降级为空对象并走 Core unavailable 路径的既有语义不变）。
Pi 只 fetch/cache 原始 JSON；形状校验、registry 可用性、identity、authority、
merge 全在 Core。provider-only（`api.json` 形状）或不可用 payload 由 Core 按其
`catalog-input` 契约处理（不做 canonical 解析；LiteLLM 完整者仍发布；其余
`metadata-unavailable` + LKG 可恢复），Pi 仅透传并在诊断中提示改用 catalog 形状。

#### Scenario: 默认拉取 catalog 快照

- **WHEN** 扩展刷新 models.dev 数据且无自定义 URL
- **THEN** 请求 `https://models.dev/catalog.json`，成功后同一 TTL 内复用，不再请求 `api.json`

#### Scenario: catalog 不可用时降级不断

- **WHEN** catalog 获取失败或形状不可用
- **THEN** 本轮按 Core unavailable 路径完成（LiteLLM 完整者发布、其余 withheld + 有效 LKG 恢复），并记录一次脱敏 warning
