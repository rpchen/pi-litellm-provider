# litellm-connection

## MODIFIED Requirements

### Requirement: LiteLLM 地址经全局配置文件或环境变量提供
扩展 SHALL 只从全局来源解析 LiteLLM 根地址：legacy 单 endpoint 模式下优先级从高到低为环境变量 `LITELLM_BASE_URL`、全局配置文件 `~/.pi/agent/litellm.json` 的 `baseUrl` 字段；显式 `endpoints` 模式下地址只来自同一全局配置文件的 `endpoints.<id>.baseUrl`，且 MUST NOT 读取 `LITELLM_BASE_URL`。扩展 MUST NOT 读取项目级 `.pi/litellm.json`（PR9 起移除，旧用户无需迁移）。地址已取得（非空且合法）时连接视为已配置；地址缺失时扩展 SHALL 视为未连接，不注册任何模型，并在加载时记录一条说明性提示。扩展 MUST NOT 内置或默认任何特定 LiteLLM 地址。配置文件缺失或字段非法时 SHALL 记录警告并继续解析（legacy 模式回退下一来源），MUST NOT 导致扩展加载失败；配置文件中未知字段 SHALL 被忽略。legacy 单 endpoint 字段（顶层 `baseUrl` / `protocolOverrides`）与 `endpoints` MUST NOT 在同一配置中混用；混用时 SHALL 拒绝该配置并记录警告。

#### Scenario: 仅环境变量可用
- **WHEN** 用户设置 `LITELLM_BASE_URL=http://litellm.example:4000` 后启动 pi，无任何配置文件
- **THEN** 扩展用该地址发现模型

#### Scenario: 地址缺失
- **WHEN** 全局配置文件不存在或未提供 `baseUrl`，且未设置 `LITELLM_BASE_URL`
- **THEN** 扩展不注册模型，记录提示用户设置地址的警告

#### Scenario: 配置文件字段非法
- **WHEN** 配置文件的 `baseUrl` 为非字符串或非 http(s) URI
- **THEN** 扩展跳过该来源继续向下一来源解析，记录警告，不抛出加载错误

#### Scenario: 显式 endpoints 模式忽略 LITELLM_BASE_URL
- **WHEN** 全局配置文件定义了 `endpoints`，同时环境变量设置了 `LITELLM_BASE_URL`
- **THEN** 扩展记录“显式 endpoints 模式不会读取 LITELLM_BASE_URL”的警告，只使用 `endpoints.<id>.baseUrl` 作为各 endpoint 地址

#### Scenario: legacy 字段与 endpoints 混用被拒绝
- **WHEN** 同一全局配置文件同时出现顶层 `baseUrl`（或 `protocolOverrides`）与 `endpoints`
- **THEN** 扩展拒绝该配置并记录警告，不加载显式 endpoints
