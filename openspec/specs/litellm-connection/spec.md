# litellm-connection Specification

## Purpose
定义 pi 扩展如何取得用户的 LiteLLM 地址与 API Key：Key 首选经 pi 宿主原生 `/login` 流程录入（`auth.json` 持久化），环境变量兜底；地址经扩展自有配置文件或环境变量提供。规定地址规范化、凭据保密、同一把 Key 同时用于发现与模型调用，以及 Key 无效或未配置时的行为。

## Requirements

### Requirement: API Key 经宿主认证链提供
扩展注册 provider 时 SHALL 把 `apiKey` 配置为 `$LITELLM_API_KEY` 形式的环境变量引用，交由 pi 宿主统一解析；宿主解析顺序为：`/login` 存入的凭据（`~/.pi/agent/auth.json`）优先，其次为环境变量。扩展 MUST NOT 自行解析或存储 Key。用户 SHALL 可以通过 pi 的 `/login` 命令选择 LiteLLM 并粘贴 Key 完成录入（宿主存入 auth.json，`/logout` 移除），也 SHALL 可以通过设置 `LITELLM_API_KEY` 环境变量提供；两条途径都经宿主解析链，发现与模型调用 SHALL 因此使用同一把 Key。宿主未解析到任何 Key 时，provider 视为未配置，LiteLLM 模型不出现在模型选择器中。

#### Scenario: 经 /login 录入 Key
- **WHEN** 用户在 pi 中执行 `/login`，选择 LiteLLM，粘贴 API Key
- **THEN** 宿主把 Key 存入 auth.json，扩展在下一次刷新中用该 Key 发现模型，无需设置任何环境变量

#### Scenario: 环境变量兜底
- **WHEN** 用户未执行过 `/login`，但设置了 `LITELLM_API_KEY`
- **THEN** 宿主用环境变量中的 Key 解析凭据，扩展正常发现模型

#### Scenario: stored 凭据优先于环境变量
- **WHEN** 用户已通过 `/login` 存入 Key K1，同时环境中存在 `LITELLM_API_KEY=K2`
- **THEN** 发现与调用使用 K1（宿主解析顺序：stored credential 优先）

#### Scenario: 无任何 Key
- **WHEN** 用户既没有 `/login` 过，也没有设置 `LITELLM_API_KEY`
- **THEN** LiteLLM provider 未配置，模型不出现在选择器中，扩展不发起任何发现请求

### Requirement: LiteLLM 地址经配置文件或环境变量提供
扩展 SHALL 从以下来源解析 LiteLLM 根地址，优先级从高到低：环境变量 `LITELLM_BASE_URL`；项目级配置文件 `.pi/litellm.json`（当前工作目录下）的 `baseUrl` 字段；全局配置文件 `~/.pi/agent/litellm.json` 的 `baseUrl` 字段。地址已取得（非空且合法）时连接视为已配置；地址缺失时扩展 SHALL 视为未连接，不注册任何模型，并在加载时记录一条说明性提示。扩展 MUST NOT 内置或默认任何特定 LiteLLM 地址。配置文件缺失或字段非法时 SHALL 回退到下一来源并记录警告，MUST NOT 导致扩展加载失败；配置文件中未知字段 SHALL 被忽略。

#### Scenario: 仅环境变量可用
- **WHEN** 用户设置 `LITELLM_BASE_URL=http://litellm.example:4000` 后启动 pi，无任何配置文件
- **THEN** 扩展用该地址发现模型

#### Scenario: 项目级覆盖全局
- **WHEN** 全局配置文件写入 `http://litellm.example:4000`，项目目录的 `.pi/litellm.json` 写入 `http://litellm.example:4001`
- **THEN** 当前项目内使用 `http://litellm.example:4001`，其他项目使用全局地址

#### Scenario: 地址缺失
- **WHEN** 三个来源都没有提供地址
- **THEN** 扩展不注册模型，记录提示用户设置地址的警告

#### Scenario: 配置文件字段非法
- **WHEN** 配置文件的 `baseUrl` 为非字符串或非 http(s) URI
- **THEN** 扩展跳过该来源继续向下一来源解析，记录警告，不抛出加载错误

### Requirement: 地址规范化
扩展 SHALL 接受带或不带 `/v1` 后缀、带或不带末尾斜杠的 http(s) 地址，并规范化为 LiteLLM 根地址后用于发现；协议映射所需的 API 基地址由规范化根地址推导。地址校验分为两级：配置来源中的非法地址（非字符串或非 http(s)）SHALL 被跳过该来源并记录警告、回退下一来源；所有来源均无法给出合法地址时 SHALL 视为未连接。最终采用的地址若无法通过规范化（如包含用户信息），SHALL 不发起任何发现请求、撤下已注册模型并记录错误。

#### Scenario: 带尾斜杠的地址
- **WHEN** 地址为 `http://litellm.example:4000/`
- **THEN** 发现请求发往 `http://litellm.example:4000/v1/model/info`

#### Scenario: 带 /v1 的地址
- **WHEN** 地址为 `http://litellm.example:4000/v1/`
- **THEN** 发现请求发往 `http://litellm.example:4000/v1/model/info`，不出现 `/v1/v1`

#### Scenario: 非 http(s) 地址
- **WHEN** 任一配置来源给出 `ftp://litellm.example` 或无法解析的地址
- **THEN** 该来源被跳过并记录警告、回退下一来源；若所有来源都无法给出合法地址，扩展视为未连接（不发起发现请求、不注册模型）

#### Scenario: 已采用的地址无法规范化
- **WHEN** 最终采用的地址为 `http://user:pass@litellm.example:4000`
- **THEN** 扩展不发起任何发现请求、撤下已注册的模型，并记录错误

### Requirement: 发现与调用使用同一把用户 Key
扩展 MUST 使用宿主解析出的同一把 API Key 进行发现与模型调用，MUST NOT 要求或使用任何额外的管理员 Key。发现用的 Key 与调用用的 Key 不一致的情况 MUST NOT 出现。

#### Scenario: 团队 Key 只看到团队模型
- **WHEN** 用户的 Key 只被授权访问团队模型集合 A
- **THEN** 注册的模型集合不超出 A 中实际存在部署的模型

### Requirement: 凭据保密
扩展 MUST NOT 把 API Key 写入日志、错误信息、注册的 provider / 模型定义或任何仓库文件；错误信息中出现的 Key MUST 被脱敏。扩展 MUST NOT 把 LiteLLM 或 models.dev 的响应体写入日志。

#### Scenario: 发现请求失败
- **WHEN** 发现请求返回 401
- **THEN** 扩展记录的错误包含地址与状态码，但不包含 Key 明文

### Requirement: Key 无效时撤下模型
发现请求返回 401 或 403 时，扩展 SHALL 撤下全部 LiteLLM 模型，并记录明确指出 Key 无效或无权限的错误；下一次刷新成功后模型 SHALL 恢复。

#### Scenario: Key 被吊销
- **WHEN** 用户的 Key 在 LiteLLM 端被删除，下一次发现返回 401
- **THEN** LiteLLM 模型从模型选择器中消失，错误提示 Key 无效
