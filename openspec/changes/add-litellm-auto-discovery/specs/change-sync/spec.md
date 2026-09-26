## Purpose

定义发现结果何时刷新、如何判断 LiteLLM 端发生了变化、网络失败时如何降级，确保 pi 中的模型清单自动跟随 LiteLLM 端变更，同时不因短暂故障丢失可用模型。刷新触发适配 pi 宿主的 `refreshModels` 机制；失败降级行为与 ../opencode-litellm-provider 的 change-sync 能力一致。

## ADDED Requirements

### Requirement: 刷新触发
扩展 SHALL 在以下时机执行发现：pi 宿主调用 `refreshModels` 且允许网络访问时（宿主在启动、打开模型选择器等时机触发）；此外扩展 SHALL 在自身生命周期内按轮询间隔周期触发一次宿主刷新并等待其完成。轮询间隔 SHALL 默认 5 分钟，可通过扩展配置调整，最小 30 秒。`refreshModels` 收到的 abort signal SHALL 被传递给所有阻塞网络 IO。

#### Scenario: 管理员新增模型
- **WHEN** LiteLLM 管理员新增一个对话模型部署，且用户的 Key 有权访问
- **THEN** 在一个轮询间隔内，该模型出现在 pi 模型选择器中，无需重启 pi

#### Scenario: 管理员删除模型
- **WHEN** LiteLLM 管理员删除某模型的全部部署
- **THEN** 在一个轮询间隔内，该模型从模型选择器中消失

#### Scenario: 取消刷新
- **WHEN** pi 宿主中止一次进行中的刷新（abort signal 触发）
- **THEN** 网络请求随 signal 中止，注册结果保持不变，不发布半成品清单

### Requirement: 宿主两阶段刷新语义
`refreshModels` 的 restore 阶段（不允许网络）SHALL 返回宿主持久化的上次成功清单（`context.stored`）；network 阶段（凭据解析成功才进入）SHALL 执行真实发现，成功结果（包括空清单）经 `context.publish({ persist })` 交宿主 models store 持久化，使空结果与撤下状态跨重启保持。持久化写入失败 MUST NOT 阻止本次发现结果生效。

#### Scenario: 重启后先回放再校正
- **WHEN** 上次会话成功发现 8 个模型并已持久化，本次启动 LiteLLM 暂不可达
- **THEN** restore 阶段先回放这 8 个模型（可选中使用），network 阶段失败后宿主保留该清单并报错，恢复后的下次刷新校正

#### Scenario: 空清单跨重启保持撤下
- **WHEN** 一次发现成功但过滤后没有任何对话模型，随后 pi 重启
- **THEN** 本次持久化空清单；重启后 restore 阶段也不回放旧模型，LiteLLM 下没有可用模型；下次成功发现后新清单正常持久化

### Requirement: 注册结果整体替换
每次成功发现后，扩展 SHALL 以本次发现的全部模型整体替换 LiteLLM provider 的模型清单；已从 LiteLLM 消失的模型自然被移除，不需要逐个删除。

#### Scenario: 模型集合变化
- **WHEN** 本次发现得到模型集合 B，上次为集合 A
- **THEN** LiteLLM provider 下恰好注册 B 中的全部模型，A 中不在 B 的模型不可用

### Requirement: 仅在内容变化时更新
扩展 SHALL 比较本次与上次成功发现的注册结果（稳定序列化后的指纹）；结果一致时 MUST NOT 触发宿主刷新或产生持久化写入。

#### Scenario: 无变化的轮询
- **WHEN** 连续两次轮询返回的模型与元数据完全一致
- **THEN** 第二次轮询不产生注册变更与持久化写入

### Requirement: LiteLLM 不可达时保留上次结果
发现请求失败（网络错误、超时、429、5xx、响应无法解析）时，扩展 SHALL 保留上次成功的注册结果，并在下一个刷新周期重试；扩展 SHALL 记录一条警告（不含 Key）。3xx 重定向 SHALL 不被跟随并按网络错误处理。

#### Scenario: 短暂网络中断
- **WHEN** 已注册 10 个模型后，下一次刷新请求超时
- **THEN** 10 个模型仍然可用，下个周期继续尝试

### Requirement: 认证失败时撤下模型
发现请求返回 401 或 403 时，扩展 SHALL 撤下全部 LiteLLM 模型，并记录明确指出 Key 无效或无权限的错误。

#### Scenario: Key 被吊销
- **WHEN** 用户的 Key 在 LiteLLM 端被删除，下一次刷新返回 401
- **THEN** LiteLLM 模型从模型选择器中消失，日志提示 Key 无效

### Requirement: models.dev 不可达时的降级
models.dev 获取失败时，扩展 SHALL 继续仅用 LiteLLM 数据注册模型（不生成推理档位、不补充缺失字段），并在后续刷新中重试获取 models.dev；models.dev 的成功结果 SHALL 被缓存，缓存有效期内不重复请求。

#### Scenario: models.dev 超时
- **WHEN** 首次发现时 models.dev 请求超时，LiteLLM 正常
- **THEN** 模型按 LiteLLM 数据注册且没有推理档位；之后某次刷新成功获取 models.dev 后，推理档位出现

### Requirement: 首次发现完成前的状态
已配置连接但首次发现尚未成功时，扩展 SHALL 不注册任何模型，也 MUST NOT 注册占位模型。

#### Scenario: 启动时 LiteLLM 不可达
- **WHEN** pi 启动时 LiteLLM 不可达且此前没有成功结果
- **THEN** LiteLLM 暂无模型；LiteLLM 恢复后的下一次刷新注册模型

### Requirement: 轮询生命周期
扩展 SHALL 不在扩展工厂中启动任何定时器或长生命周期资源；轮询所需的长生命周期状态 SHALL 在 `session_start` 事件后初始化，并在幂等的 `session_shutdown` 时停止与清理，重复的启停事件 MUST NOT 造成泄漏或重复轮询。

#### Scenario: /reload 后不重复轮询
- **WHEN** pi 会话重载（session_shutdown 后再次 session_start）
- **THEN** 旧的轮询定时器被清理，同一时刻只有一个轮询循环在运行