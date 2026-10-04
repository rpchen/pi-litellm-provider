# model-discovery Specification

## Purpose
随 `trusted-model-capability-publication` 更新两处已被 Core 新语义取代的规则： family 模态例外与 toggle 推理标志。本文件只含 MODIFIED 增量；其余需求不变。

## MODIFIED Requirements

### Requirement: 能力字段映射与数据源优先级
扩展 SHALL 按以下优先级确定每个字段：LiteLLM 部署信息中的值 > models.dev 选中记录中的值 > pi 默认值。LiteLLM 字段为 null、缺失或类型不符时 SHALL 视为“未提供”，继续向下一来源回退，而不是当作 false 或 0。映射至少包括：上下文 / 输入上限 `max_input_tokens`；输出上限 `max_output_tokens`（缺失时回退 `max_tokens`）；工具调用 `supports_function_calling`；输入模态（文本恒有；`supports_vision` → 图片）、输出模态。pi 的输入模态只有 text 与 image 两种；LiteLLM / models.dev 声明的 PDF、音频、视频输入模态 SHALL 被丢弃，不影响文本与图片的判定。模态合并由 Core 确定性规则完成（仅显式声明或有 provenance 的确定性继承生效，无 family 特判）；扩展直接消费 Core 结果，不再维护 DeepSeek / Kimi / MiMo / Qwen 家族例外。是否允许正常发布由 Core 发布判定决定；线缆上的布尔默认值不得用于发布决策。

#### Scenario: LiteLLM 缺失输出上限
- **WHEN** 某部署没有 `max_output_tokens` 与 `max_tokens`，而 models.dev 选中记录的 `limit.output` 为 65536
- **THEN** 注册的输出上限为 65536

#### Scenario: 两个来源冲突
- **WHEN** 某 GPT 部署的 LiteLLM 信息显式给出 `supports_vision: false`，models.dev 记录的输入模态包含 image
- **THEN** 注册的输入模态不包含图片

#### Scenario: 非文本图片模态被丢弃
- **WHEN** models.dev 选中记录声明输入模态包含 pdf 与 audio
- **THEN** 注册的输入模态只保留映射到 pi 支持的 text 与 image

#### Scenario: 模态信任名单
- **WHEN** `kimi-k2.6` 的 LiteLLM 部署只给出文本输入，models.dev 选中记录的输入模态为 text、image、video
- **THEN** 注册的输入模态包含 text 与 image（video 被 pi 模态集合丢弃）

### Requirement: 推理档位来源
扩展 SHALL 仅依据上一条规则选中的 models.dev 记录的 `reasoning_options` 生成推理档位；扩展 MUST NOT 依据 LiteLLM 的 `supports_*_reasoning_effort` 等字段生成或删减档位。档位 SHALL 翻译为 pi 的 `thinkingLevelMap`，规则如下：
- `type: effort` 的每个取值映射到同名 pi 档位（`none` 映射到 `off`）；记录未声明的 pi 档位 SHALL 显式置 `null` 隐藏，使模型选择器只提供实际可用的档位。
- `type: budget_tokens` 且协议为 Anthropic Messages 时，生成 `high` 与（记录声明最大值时）`max` 两个档位；记录未声明最大值时只生成 `high`；声明的最大值不超过 16000 时只生成 `high`。`off` 不写键（保持可关闭思考）；`minimal`/`low`/`medium` 与未声明的 `max` 置 `null` 隐藏。档位对应的预算数值由 pi 宿主按自身设置推导（扩展注册接口无法按模型注入预算数值），扩展 MUST NOT 通过映射值编码预算。
- `type: toggle` 不生成档位，但模型按支持 reasoning 注册（`reasoning` 为 true 且无档位表）。无 `reasoning_options` 或无选中记录时 SHALL 不生成档位；`reasoning` 标志服从 Core `reasoningSupported` verdict（supported 为 true，unsupported/unknown 为 false），MUST NOT 从档位数量推导。

#### Scenario: effort 档位
- **WHEN** 走 responses 协议的模型 `gpt-5.5` 选中记录的 `reasoning_options` 为 `[{type: effort, values: [none, low, medium, high, xhigh]}]`
- **THEN** 该模型的 thinkingLevelMap 给出 `off`、`low`、`medium`、`high`、`xhigh` 五个档位，`minimal` 与 `max` 为 `null`，`reasoning` 为 true

#### Scenario: budget 档位
- **WHEN** 走 Messages 协议的模型选中记录的 `reasoning_options` 为 `[{type: budget_tokens, max: 64000}]`
- **THEN** 该模型的 thinkingLevelMap 给出 `high` 与 `max` 两个档位（`minimal`/`low`/`medium` 为 `null`），`reasoning` 为 true

#### Scenario: 只有 toggle
- **WHEN** 选中记录的 `reasoning_options` 为 `[{type: toggle}]`，LiteLLM 给出 `supports_reasoning: true`
- **THEN** 模型正常注册，`reasoning` 为 true 且没有任何档位
